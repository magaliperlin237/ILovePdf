using Microsoft.AspNetCore.Http;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace ILovePDF.Services;

/// <summary>
/// Signature VISUELLE : l'image de la signature est dessinée sur la page.
/// Ce n'est pas une signature électronique à valeur légale (pas de certificat ni d'horodatage).
/// </summary>
public sealed class PdfSignService : IPdfSignService
{
    private const int MaxPlacements = 2000;
    private const long MaxSignaturePixels = 4_000_000;
    private const int MaxSignatureWidth = 1200;

    public async Task<byte[]> SignAsync(IFormFile pdf, IFormFile signature, IReadOnlyList<SignaturePlacement> placements)
    {
        if (placements == null || placements.Count == 0)
            throw new ArgumentException("Placez au moins une signature sur le document.");

        if (placements.Count > MaxPlacements)
            throw new ArgumentException("Trop de signatures demandées.");

        foreach (var p in placements)
        {
            if (!double.IsFinite(p.X) || !double.IsFinite(p.Y) || !double.IsFinite(p.Width) || !double.IsFinite(p.Height)
                || p.Width <= 0 || p.Height <= 0 || p.Width > 1 || p.Height > 1 || p.X < -0.001 || p.Y < -0.001
                || p.X + p.Width > 1.001 || p.Y + p.Height > 1.001)
            {
                throw new ArgumentException("L'emplacement d'une signature est invalide.");
            }
        }

        // Signature : relue et normalisée par ImageSharp (PNG 8 bits avec transparence, taille raisonnable).
        await using var sigInput = new MemoryStream();
        await signature.CopyToAsync(sigInput);
        sigInput.Position = 0;

        var info = await Image.IdentifyAsync(sigInput);
        if ((long)info.Width * info.Height > MaxSignaturePixels)
            throw new ArgumentException("L'image de la signature est trop grande.");

        sigInput.Position = 0;
        using var sigImage = await Image.LoadAsync<Rgba32>(sigInput);
        if (sigImage.Width > MaxSignatureWidth)
        {
            var height = Math.Max(1, (int)Math.Round(sigImage.Height * (double)MaxSignatureWidth / sigImage.Width));
            sigImage.Mutate(ctx => ctx.Resize(MaxSignatureWidth, height));
        }

        // Le flux doit rester ouvert jusqu'à document.Save() (lecture différée de PDFsharp).
        using var sigPng = new MemoryStream();
        await sigImage.SaveAsPngAsync(sigPng);
        sigPng.Position = 0;
        using var xImage = XImage.FromStream(sigPng);

        await using var input = new MemoryStream();
        await pdf.CopyToAsync(input);
        input.Position = 0;

        using var document = PdfReader.Open(input, PdfDocumentOpenMode.Modify);

        foreach (var p in placements)
        {
            if (p.Page < 1 || p.Page > document.PageCount)
                throw new ArgumentException($"La page {p.Page} n'existe pas : le document contient {document.PageCount} page(s).");
        }

        foreach (var group in placements.GroupBy(p => p.Page))
        {
            var page = document.Pages[group.Key - 1];
            using var gfx = XGraphics.FromPdfPage(page, XGraphicsPdfPageOptions.Append);

            foreach (var p in group)
                DrawSignature(gfx, page, xImage, p);
        }

        using var output = new MemoryStream();
        document.Save(output, false);
        return output.ToArray();
    }

    /// <summary>
    /// Dessine la signature en tenant compte de la rotation de la page (/Rotate) :
    /// l'emplacement est exprimé sur la page affichée, il est converti dans le repère de la page non tournée.
    /// </summary>
    private static void DrawSignature(XGraphics gfx, PdfPage page, XImage image, SignaturePlacement p)
    {
        double pageW = page.Width.Point;
        double pageH = page.Height.Point;
        var rotation = ((page.Rotate % 360) + 360) % 360;
        var sideways = rotation == 90 || rotation == 270;

        double displayW = sideways ? pageH : pageW;
        double displayH = sideways ? pageW : pageH;

        var w = p.Width * displayW;
        var h = p.Height * displayH;
        var cx = p.X * displayW + w / 2; // centre sur la page affichée
        var cy = p.Y * displayH + h / 2;

        var (ux, uy) = rotation switch
        {
            90 => (cy, pageH - cx),
            180 => (pageW - cx, pageH - cy),
            270 => (pageW - cy, cx),
            _ => (cx, cy)
        };

        var state = gfx.Save();
        try
        {
            gfx.TranslateTransform(ux, uy);
            if (rotation != 0)
                gfx.RotateTransform(-rotation);

            gfx.DrawImage(image, -w / 2, -h / 2, w, h);
        }
        finally
        {
            gfx.Restore(state);
        }
    }
}
