using Microsoft.AspNetCore.Http;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;
using System.IO.Compression;

namespace ILovePDF.Services;

/// <summary>
/// Éclaircit une image avec une courbe tonale : une correction gamma (qui remonte surtout les ombres
/// et les tons moyens) suivie d'un gain linéaire. À 100 %, l'effet est maximal.
/// La même formule est utilisée dans le navigateur (image-brighten.js) pour l'aperçu en direct.
/// </summary>
public sealed class ImageBrightenService : IImageBrightenService
{
    private const long MaxPixels = 40_000_000; // protège la mémoire du serveur
    private const double A4WidthPt = 595.28;
    private const double A4HeightPt = 841.89;
    private const double A4MarginPt = 28.35;   // 1 cm
    private const double ImagePageDpi = 150.0;

    private static readonly HashSet<string> SupportedExtensions =
        new(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff" };

    private static readonly Dictionary<string, (string Extension, string ContentType)> FormatInfo =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["pdf"] = ("pdf", "application/pdf"),
            ["png"] = ("png", "image/png"),
            ["jpg"] = ("jpg", "image/jpeg"),
            ["webp"] = ("webp", "image/webp"),
            ["bmp"] = ("bmp", "image/bmp"),
            ["tiff"] = ("tiff", "image/tiff"),
        };

    public static IReadOnlyCollection<string> AllowedFormats => FormatInfo.Keys;

    public bool IsSupportedImage(IFormFile file)
    {
        if (file == null || file.Length == 0)
            return false;

        return SupportedExtensions.Contains(Path.GetExtension(file.FileName));
    }

    public async Task<BrightenResult> BrightenAsync(IFormFile file, ImageBrightenOptions options)
    {
        var formats = options.Formats
            .Select(f => f.Trim().ToLowerInvariant())
            .Where(f => FormatInfo.ContainsKey(f))
            .Distinct()
            .ToList();

        if (formats.Count == 0)
            throw new ArgumentException("Aucun format de sortie valide.");

        await using var source = new MemoryStream();
        await file.CopyToAsync(source);

        // Vérifie la taille en pixels avant de décoder l'image complète.
        source.Position = 0;
        var info = await Image.IdentifyAsync(source);
        if ((long)info.Width * info.Height > MaxPixels)
            throw new ArgumentException("L'image est trop grande (limite : 40 mégapixels).");

        source.Position = 0;
        using var image = await Image.LoadAsync<Rgba32>(source);
        image.Mutate(ctx => ctx.AutoOrient());

        ApplyBrightness(image, options.Strength);

        var baseName = SanitizeFileName(Path.GetFileNameWithoutExtension(file.FileName));

        if (formats.Count == 1)
        {
            var (ext, contentType) = FormatInfo[formats[0]];
            var bytes = await EncodeAsync(image, formats[0], options.PdfPage);
            return new BrightenResult(bytes, contentType, $"{baseName}_eclairci.{ext}");
        }

        using var zipStream = new MemoryStream();
        using (var zip = new ZipArchive(zipStream, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var format in formats)
            {
                var bytes = await EncodeAsync(image, format, options.PdfPage);
                var entry = zip.CreateEntry($"{baseName}_eclairci.{FormatInfo[format].Extension}", CompressionLevel.Fastest);
                await using var entryStream = entry.Open();
                await entryStream.WriteAsync(bytes);
            }
        }

        return new BrightenResult(zipStream.ToArray(), "application/zip", $"{baseName}_eclairci.zip");
    }

    // ---------- éclaircissement ----------

    /// <summary>Table de correspondance 0–255 → 0–255 pour l'intensité demandée.</summary>
    internal static byte[] BuildLut(int strength)
    {
        var s = Math.Clamp(strength, 0, 100) / 100.0;
        var gamma = 1.0 - 0.65 * s; // 1 → 0,35 : remonte fortement les ombres
        var gain = 1.0 + 0.6 * s;   // 1 → 1,6  : pousse ensuite les tons clairs

        var lut = new byte[256];
        for (var i = 0; i < 256; i++)
        {
            var v = Math.Pow(i / 255.0, gamma) * gain;
            lut[i] = (byte)Math.Clamp((int)Math.Round(v * 255.0), 0, 255);
        }

        return lut;
    }

    private static void ApplyBrightness(Image<Rgba32> image, int strength)
    {
        var lut = BuildLut(strength);

        image.ProcessPixelRows(accessor =>
        {
            for (var y = 0; y < accessor.Height; y++)
            {
                var row = accessor.GetRowSpan(y);
                for (var x = 0; x < row.Length; x++)
                {
                    ref var px = ref row[x];
                    px.R = lut[px.R];
                    px.G = lut[px.G];
                    px.B = lut[px.B];
                    // le canal alpha (transparence) est conservé tel quel
                }
            }
        });
    }

    // ---------- encodage ----------

    private static async Task<byte[]> EncodeAsync(Image<Rgba32> bright, string format, string pdfPage)
    {
        using var output = new MemoryStream();

        // PNG et WebP gardent la transparence ; les autres formats sont aplatis sur fond blanc.
        if (format is "png" or "webp")
        {
            if (format == "png")
                await bright.SaveAsPngAsync(output);
            else
                await bright.SaveAsWebpAsync(output, new WebpEncoder { Quality = 95 });

            return output.ToArray();
        }

        using var flat = bright.Clone(ctx => ctx.BackgroundColor(Color.White));

        switch (format)
        {
            case "jpg":
                await flat.SaveAsJpegAsync(output, new JpegEncoder { Quality = 95 });
                break;
            case "bmp":
                await flat.SaveAsBmpAsync(output);
                break;
            case "tiff":
                await flat.SaveAsTiffAsync(output);
                break;
            case "pdf":
                return await BuildPdfAsync(flat, pdfPage);
        }

        return output.ToArray();
    }

    private static async Task<byte[]> BuildPdfAsync(Image<Rgba32> flat, string pdfPage)
    {
        // Le flux de l'image doit rester ouvert jusqu'à document.Save() (lecture différée de PDFsharp).
        using var jpegStream = new MemoryStream();
        await flat.SaveAsJpegAsync(jpegStream, new JpegEncoder { Quality = 95 });
        jpegStream.Position = 0;

        using var document = new PdfDocument();
        document.Info.Title = "Image éclaircie";

        using var xImage = XImage.FromStream(jpegStream);
        var page = document.AddPage();

        double pageWidth, pageHeight, x, y, drawWidth, drawHeight;

        if (string.Equals(pdfPage, "image", StringComparison.OrdinalIgnoreCase))
        {
            // Page exactement à la taille de l'image (150 dpi), sans marge.
            pageWidth = Math.Clamp(flat.Width * 72.0 / ImagePageDpi, 72, 14400);
            pageHeight = Math.Clamp(flat.Height * 72.0 / ImagePageDpi, 72, 14400);
            x = 0;
            y = 0;
            drawWidth = pageWidth;
            drawHeight = pageHeight;
        }
        else
        {
            // A4, orientation choisie selon l'image, image agrandie ou réduite pour remplir la page.
            var landscape = flat.Width > flat.Height;
            pageWidth = landscape ? A4HeightPt : A4WidthPt;
            pageHeight = landscape ? A4WidthPt : A4HeightPt;

            var maxWidth = pageWidth - A4MarginPt * 2;
            var maxHeight = pageHeight - A4MarginPt * 2;
            var scale = Math.Min(maxWidth / flat.Width, maxHeight / flat.Height);

            drawWidth = flat.Width * scale;
            drawHeight = flat.Height * scale;
            x = (pageWidth - drawWidth) / 2;
            y = (pageHeight - drawHeight) / 2;
        }

        page.Width = XUnit.FromPoint(pageWidth);
        page.Height = XUnit.FromPoint(pageHeight);

        using (var graphics = XGraphics.FromPdfPage(page))
        {
            graphics.DrawImage(xImage, x, y, drawWidth, drawHeight);
        }

        using var pdfStream = new MemoryStream();
        document.Save(pdfStream, false);
        return pdfStream.ToArray();
    }

    private static string SanitizeFileName(string name)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var clean = new string(name.Where(c => !invalid.Contains(c)).ToArray()).Trim();
        return string.IsNullOrWhiteSpace(clean) ? "image" : clean;
    }
}
