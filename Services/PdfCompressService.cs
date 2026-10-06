using Microsoft.AspNetCore.Http;
using PdfSharp.Pdf;
using PdfSharp.Pdf.Advanced;
using PdfSharp.Pdf.IO;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace ILovePDF.Services;

/// <summary>
/// Réduit le poids d'un PDF en recompressant les images JPEG qu'il contient
/// (réduction de la définition et de la qualité). Le texte, les polices et les vecteurs ne sont pas modifiés.
/// Les images dans d'autres formats (Flate, JPEG 2000, masques…) sont laissées telles quelles.
/// </summary>
public sealed class PdfCompressService : IPdfCompressService
{
    private const long MaxImagePixels = 60_000_000;
    private const int MinStreamBytes = 4096; // inutile de toucher aux petites images

    private sealed class Stats
    {
        public int Total;
        public int Optimized;
    }

    public async Task<PdfCompressResult> CompressAsync(IFormFile file, PdfCompressionLevel level)
    {
        await using var input = new MemoryStream();
        await file.CopyToAsync(input);
        var originalBytes = input.ToArray();
        input.Position = 0;

        using var document = PdfReader.Open(input, PdfDocumentOpenMode.Modify);

        var (maxDimension, quality) = GetSettings(level);
        var stats = new Stats();
        var visited = new HashSet<PdfDictionary>(ReferenceEqualityComparer.Instance);

        foreach (PdfPage page in document.Pages)
            ProcessResources(page, maxDimension, quality, visited, stats);

        using var output = new MemoryStream();
        document.Save(output, false);
        var compressed = output.ToArray();

        // Si le résultat n'est pas plus léger, on rend le fichier d'origine.
        var bytes = compressed.Length < originalBytes.Length ? compressed : originalBytes;
        return new PdfCompressResult(bytes, stats.Total, stats.Optimized);
    }

    private static void ProcessResources(
        PdfDictionary holder, int maxDimension, int quality, HashSet<PdfDictionary> visited, Stats stats)
    {
        var resources = holder.Elements.GetDictionary("/Resources");
        var xObjects = resources?.Elements.GetDictionary("/XObject");
        if (xObjects == null)
            return;

        foreach (var item in xObjects.Elements.Values.ToList())
        {
            var xObject = (item as PdfReference)?.Value as PdfDictionary ?? item as PdfDictionary;
            if (xObject == null || !visited.Add(xObject))
                continue; // déjà traité (image partagée entre plusieurs pages)

            var subtype = xObject.Elements.GetName("/Subtype");
            if (subtype == "/Image")
            {
                stats.Total++;
                if (TryRecompress(xObject, maxDimension, quality))
                    stats.Optimized++;
            }
            else if (subtype == "/Form")
            {
                ProcessResources(xObject, maxDimension, quality, visited, stats);
            }
        }
    }

    private static bool TryRecompress(PdfDictionary image, int maxDimension, int quality)
    {
        try
        {
            // Seules les images JPEG « simples » sont traitées.
            if (image.Elements.GetName("/Filter") != "/DCTDecode")
                return false;
            if (image.Elements.GetBoolean("/ImageMask") || image.Elements.ContainsKey("/Mask"))
                return false;

            var original = image.Stream?.Value;
            if (original == null || original.Length < MinStreamBytes)
                return false;

            using var source = new MemoryStream(original);
            var info = Image.Identify(source);
            if ((long)info.Width * info.Height > MaxImagePixels)
                return false;

            var isCmyk = info.PixelType.BitsPerPixel >= 32;
            var isGray = info.PixelType.BitsPerPixel <= 8;

            // Un /Decode sur une image RGB ou grise inverse les valeurs : on préfère ne pas y toucher.
            if (!isCmyk && image.Elements.ContainsKey("/Decode"))
                return false;

            source.Position = 0;
            using var pixels = Image.Load<Rgb24>(source);

            if (Math.Max(pixels.Width, pixels.Height) > maxDimension)
            {
                pixels.Mutate(ctx => ctx.Resize(new ResizeOptions
                {
                    Size = new Size(maxDimension, maxDimension),
                    Mode = ResizeMode.Max,
                    Sampler = KnownResamplers.Lanczos3
                }));
            }

            using var encoded = new MemoryStream();
            if (isGray)
            {
                using var gray = pixels.CloneAs<L8>();
                gray.SaveAsJpeg(encoded, new JpegEncoder { Quality = quality, ColorType = JpegEncodingColor.Luminance });
            }
            else
            {
                pixels.SaveAsJpeg(encoded, new JpegEncoder { Quality = quality, ColorType = JpegEncodingColor.YCbCrRatio420 });
            }

            var result = encoded.ToArray();
            if (result.Length >= original.Length * 0.95)
                return false; // gain négligeable : on garde l'original

            image.Stream!.Value = result;
            image.Elements.SetInteger("/Length", result.Length);
            image.Elements.SetInteger("/Width", pixels.Width);
            image.Elements.SetInteger("/Height", pixels.Height);
            image.Elements.SetInteger("/BitsPerComponent", 8);
            image.Elements.SetName("/ColorSpace", isGray ? "/DeviceGray" : "/DeviceRGB");
            image.Elements.Remove("/Decode");
            image.Elements.Remove("/DecodeParms");
            return true;
        }
        catch (Exception ex) when (ex is UnknownImageFormatException
                                   || ex is InvalidImageContentException
                                   || ex is NotSupportedException)
        {
            return false; // image illisible : on la laisse telle quelle
        }
    }

    // NB : mêmes valeurs affichées dans Pages/PdfCompress.cshtml.
    private static (int MaxDimension, int Quality) GetSettings(PdfCompressionLevel level) => level switch
    {
        PdfCompressionLevel.Low => (2200, 80),
        PdfCompressionLevel.High => (1200, 50),
        PdfCompressionLevel.Extreme => (900, 35),
        _ => (1600, 65)
    };
}
