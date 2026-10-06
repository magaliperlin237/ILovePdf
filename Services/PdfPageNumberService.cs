using Microsoft.AspNetCore.Http;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;

namespace ILovePDF.Services;

public sealed class PdfPageNumberService : IPdfPageNumberService
{
    private const double Margin = 28.35; // 1 cm

    public static readonly string[] Positions = { "top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right" };
    public static readonly string[] Formats = { "n", "dash", "page-n", "n-total", "page-n-total" };

    public async Task<byte[]> AddPageNumbersAsync(IFormFile file, PageNumberOptions options)
    {
        var position = options.Position.ToLowerInvariant();
        var format = options.Format.ToLowerInvariant();

        if (!Positions.Contains(position))
            throw new ArgumentException("La position de la numérotation est invalide.");
        if (!Formats.Contains(format))
            throw new ArgumentException("Le format de numérotation est invalide.");

        await using var input = new MemoryStream();
        await file.CopyToAsync(input);
        input.Position = 0;

        using var document = PdfReader.Open(input, PdfDocumentOpenMode.Modify);

        var numbered = document.PageCount - (options.SkipFirst ? 1 : 0);
        if (numbered < 1)
            throw new ArgumentException("Il n'y a aucune page à numéroter.");

        var start = Math.Clamp(options.Start, 0, 100000);
        var total = start + numbered - 1;

        var (r, g, b) = PdfFileHelper.ParseColor(options.Color);
        var font = new XFont("Arial", Math.Clamp(options.FontSize, 6, 48), XFontStyleEx.Regular);
        var brush = new XSolidBrush(XColor.FromArgb(r, g, b));
        var stringFormat = GetStringFormat(position);

        for (var i = options.SkipFirst ? 1 : 0; i < document.PageCount; i++)
        {
            var page = document.Pages[i];
            var number = start + i - (options.SkipFirst ? 1 : 0);
            var label = BuildLabel(format, number, total);

            using var gfx = XGraphics.FromPdfPage(page, XGraphicsPdfPageOptions.Append);
            var area = new XRect(Margin, Margin, page.Width.Point - Margin * 2, page.Height.Point - Margin * 2);
            gfx.DrawString(label, font, brush, area, stringFormat);
        }

        using var output = new MemoryStream();
        document.Save(output, false);
        return output.ToArray();
    }

    // NB : même logique dans wwwroot/js/pdf-number.js (aperçu).
    private static string BuildLabel(string format, int number, int total) => format switch
    {
        "dash" => $"- {number} -",
        "page-n" => $"Page {number}",
        "n-total" => $"{number} / {total}",
        "page-n-total" => $"Page {number} sur {total}",
        _ => number.ToString()
    };

    private static XStringFormat GetStringFormat(string position) => position switch
    {
        "top-left" => XStringFormats.TopLeft,
        "top-center" => XStringFormats.TopCenter,
        "top-right" => XStringFormats.TopRight,
        "bottom-left" => XStringFormats.BottomLeft,
        "bottom-right" => XStringFormats.BottomRight,
        _ => XStringFormats.BottomCenter
    };
}
