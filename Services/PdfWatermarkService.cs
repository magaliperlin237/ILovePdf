using Microsoft.AspNetCore.Http;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;

namespace ILovePDF.Services;

public sealed class PdfWatermarkService : IPdfWatermarkService
{
    private const double Margin = 24;
    private const int MaxPlacementsPerPage = 5000;

    /// <summary>Centre du texte (en points, origine en haut à gauche de la page) et son angle.</summary>
    private readonly record struct Placement(double X, double Y, double Angle);

    public async Task<byte[]> AddWatermarkAsync(IFormFile file, PdfWatermarkOptions options)
    {
        if (file == null || file.Length == 0)
            throw new ArgumentException("Le fichier PDF est vide.");

        if (string.IsNullOrWhiteSpace(options.Text))
            throw new ArgumentException("Le texte du filigrane est obligatoire.");

        var opacity = Math.Clamp(options.Opacity, 0.05, 1.0);
        var fontSize = Math.Clamp(options.FontSize, 8, 120);
        var (r, g, b) = ParseColor(options.Color);

        await using var input = new MemoryStream();
        await file.CopyToAsync(input);
        input.Position = 0;

        using var document = PdfReader.Open(input, PdfDocumentOpenMode.Modify);
        var font = new XFont("Arial", fontSize, XFontStyleEx.Bold);
        var brush = new XSolidBrush(XColor.FromArgb((int)Math.Round(opacity * 255), r, g, b));

        foreach (PdfPage page in document.Pages)
        {
            using var gfx = XGraphics.FromPdfPage(page, XGraphicsPdfPageOptions.Append);

            double width = page.Width.Point;
            double height = page.Height.Point;
            var size = gfx.MeasureString(options.Text, font);

            var placements = ComputePlacements(width, height, size.Width, size.Height, fontSize, options);

            foreach (var p in placements)
            {
                var state = gfx.Save();
                gfx.TranslateTransform(p.X, p.Y);
                if (Math.Abs(p.Angle) > 0.001)
                    gfx.RotateTransform(p.Angle);

                // Le texte est dessiné centré sur (p.X, p.Y) grâce à la translation ci-dessus.
                gfx.DrawString(options.Text, font, brush, -size.Width / 2, -size.Height / 2, XStringFormats.TopLeft);
                gfx.Restore(state);
            }
        }

        using var output = new MemoryStream();
        document.Save(output, false);
        return output.ToArray();
    }

    // NB : cet algorithme est reproduit à l'identique dans wwwroot/js/pdf-watermark.js (aperçu).
    // Toute modification ici doit être répercutée là-bas.
    private static List<Placement> ComputePlacements(
        double w, double h, double tw, double th, double fontSize, PdfWatermarkOptions o)
    {
        var result = new List<Placement>();

        if (string.Equals(o.Mode, "tiled", StringComparison.OrdinalIgnoreCase))
        {
            double s = Math.Clamp(o.Spacing, 10, 100) / 50.0;
            double stepX = tw + fontSize * 3.0 * s;
            double stepY = th + fontSize * 2.5 * s;

            double radius = Math.Sqrt(w * w + h * h) / 2 + Math.Max(tw, th);
            int rows = (int)Math.Ceiling(radius / stepY);
            int cols = (int)Math.Ceiling(radius / stepX) + 1;

            double rad = o.Angle * Math.PI / 180.0;
            double cos = Math.Cos(rad), sin = Math.Sin(rad);
            double cull = Math.Max(tw, th);

            for (int j = -rows; j <= rows; j++)
            {
                double y = j * stepY;
                double offset = o.Stagger && Math.Abs(j) % 2 == 1 ? stepX / 2 : 0;

                for (int i = -cols; i <= cols; i++)
                {
                    double x = i * stepX + offset;
                    double px = w / 2 + x * cos - y * sin;
                    double py = h / 2 + x * sin + y * cos;

                    if (px < -cull || px > w + cull || py < -cull || py > h + cull)
                        continue;

                    result.Add(new Placement(px, py, o.Angle));
                    if (result.Count >= MaxPlacementsPerPage)
                        return result;
                }
            }

            return result;
        }

        // Mode "single" : comportement historique
        var position = (o.Position ?? "center").Trim().ToLowerInvariant();

        if (position == "center")
        {
            result.Add(new Placement(w / 2, h / 2, o.Diagonal ? o.Angle : 0));
            return result;
        }

        double cx = position.EndsWith("left") ? Margin + tw / 2 : w - Margin - tw / 2;
        double cy = position.StartsWith("top") ? Margin + th / 2 : h - Margin - th / 2;
        result.Add(new Placement(cx, cy, 0));
        return result;
    }

    private static (int R, int G, int B) ParseColor(string? hex)
    {
        if (string.IsNullOrWhiteSpace(hex))
            return (90, 90, 90);

        hex = hex.Trim().TrimStart('#');
        if (hex.Length != 6 || !int.TryParse(hex, System.Globalization.NumberStyles.HexNumber, null, out var value))
            return (90, 90, 90);

        return ((value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF);
    }
}
