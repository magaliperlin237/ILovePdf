using Microsoft.AspNetCore.Http;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Processing;

namespace ILovePDF.Services;

public sealed class ImageToPdfService : IImageToPdfService
{
    private static readonly HashSet<string> SupportedExtensions =
        new(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png", ".bmp" };

    private static readonly HashSet<string> SupportedContentTypes =
        new(StringComparer.OrdinalIgnoreCase) { "image/jpeg", "image/png", "image/bmp" };

    public bool IsSupportedImage(IFormFile file)
    {
        if (file == null || file.Length == 0)
            return false;

        var extension = Path.GetExtension(file.FileName);
        return SupportedExtensions.Contains(extension)
               && (string.IsNullOrWhiteSpace(file.ContentType)
                   || SupportedContentTypes.Contains(file.ContentType));
    }

    public async Task<byte[]> ConvertToPdfAsync(
        IReadOnlyList<IFormFile> files,
        ImageCompressionLevel compressionLevel = ImageCompressionLevel.None,
        WatermarkOptions? watermark = null)
    {
        if (files == null || files.Count == 0)
            throw new ArgumentException("Au moins une image est requise.", nameof(files));

        // IMPORTANT : PDFsharp peut lire XImage de façon différée.
        // Les MemoryStream/XImage doivent donc rester vivants jusqu'à document.Save().
        using var document = new PdfDocument();
        var imageStreams = new List<MemoryStream>(files.Count);
        var pdfImages = new List<XImage>(files.Count);

        try
        {
            foreach (var file in files)
            {
                var imageStream = new MemoryStream();
                imageStreams.Add(imageStream);

                if (compressionLevel == ImageCompressionLevel.None)
                {
                    await using var source = file.OpenReadStream();
                    await source.CopyToAsync(imageStream);
                }
                else
                {
                    await using var source = file.OpenReadStream();
                    using var image = await Image.LoadAsync(source);
                    var settings = GetCompressionSettings(compressionLevel);

                    image.Mutate(ctx =>
                    {
                        ctx.AutoOrient();

                        if (image.Width > settings.MaxDimension || image.Height > settings.MaxDimension)
                        {
                            ctx.Resize(new ResizeOptions
                            {
                                Size = new Size(settings.MaxDimension, settings.MaxDimension),
                                Mode = ResizeMode.Max,
                                Sampler = KnownResamplers.Lanczos3
                            });
                        }

                        // JPEG ne supporte pas la transparence : fond blanc.
                        ctx.BackgroundColor(Color.White);
                    });

                    // Tous les niveaux de compression passent volontairement en JPEG.
                    // Cela évite qu'un gros PNG/BMP soit simplement embarqué tel quel dans le PDF.
                    await image.SaveAsJpegAsync(imageStream, new JpegEncoder
                    {
                        Quality = settings.Quality
                    });
                }

                imageStream.Position = 0;
                var pdfImage = XImage.FromStream(imageStream);
                pdfImages.Add(pdfImage);
                AddImageToPage(document, pdfImage, watermark);
            }

            using var outputStream = new MemoryStream();
            document.Save(outputStream, false);
            return outputStream.ToArray();
        }
        finally
        {
            foreach (var pdfImage in pdfImages)
                pdfImage.Dispose();

            foreach (var stream in imageStreams)
                stream.Dispose();
        }
    }

    private static void AddImageToPage(PdfDocument document, XImage image, WatermarkOptions? watermark)
    {
        var page = document.AddPage();
        const double margin = 28.35; // 1 cm
        var maxWidth = page.Width.Point - margin * 2;
        var maxHeight = page.Height.Point - margin * 2;

        var imageWidth = image.PointWidth;
        var imageHeight = image.PointHeight;

        if (imageWidth <= 0 || imageHeight <= 0)
        {
            imageWidth = image.PixelWidth;
            imageHeight = image.PixelHeight;
        }

        var scale = Math.Min(maxWidth / imageWidth, maxHeight / imageHeight);
        scale = Math.Min(scale, 1.0);

        var drawWidth = imageWidth * scale;
        var drawHeight = imageHeight * scale;
        var x = (page.Width.Point - drawWidth) / 2;
        var y = (page.Height.Point - drawHeight) / 2;

        using var graphics = XGraphics.FromPdfPage(page);
        graphics.DrawImage(image, x, y, drawWidth, drawHeight);

        if (watermark is not null && !string.IsNullOrWhiteSpace(watermark.Text))
            DrawWatermark(graphics, page, watermark);
    }

    private static void DrawWatermark(XGraphics graphics, PdfPage page, WatermarkOptions watermark)
    {
        var font = new XFont("Arial", watermark.FontSize, XFontStyleEx.Bold);
        var alpha = Math.Clamp(watermark.Opacity, 5, 80);
        var brush = new XSolidBrush(XColor.FromArgb(alpha, 80, 80, 80));
        var format = XStringFormats.Center;
        var centerX = page.Width.Point / 2;
        var centerY = page.Height.Point / 2;

        var textSize = graphics.MeasureString(watermark.Text, font);
        var x = centerX;
        var y = centerY;

        switch (watermark.Position.ToLowerInvariant())
        {
            case "topleft":
                x = 30 + textSize.Width / 2;
                y = 45;
                break;
            case "topright":
                x = page.Width.Point - 30 - textSize.Width / 2;
                y = 45;
                break;
            case "bottomleft":
                x = 30 + textSize.Width / 2;
                y = page.Height.Point - 30;
                break;
            case "bottomright":
                x = page.Width.Point - 30 - textSize.Width / 2;
                y = page.Height.Point - 30;
                break;
        }

        var state = graphics.Save();
        try
        {
            if (watermark.Position.Equals("Center", StringComparison.OrdinalIgnoreCase))
            {
                graphics.TranslateTransform(x, y);
                graphics.RotateTransform(-35);
                graphics.DrawString(watermark.Text, font, brush, 0, 0, format);
            }
            else
            {
                graphics.DrawString(watermark.Text, font, brush, x, y, format);
            }
        }
        finally
        {
            graphics.Restore(state);
        }
    }

    private static CompressionSettings GetCompressionSettings(ImageCompressionLevel level) => level switch
    {
        // Dimensions are deliberately lower than the previous version so the
        // resulting PDF has a measurable size reduction for normal photos/scans.
        ImageCompressionLevel.Low => new(2200, 80),
        ImageCompressionLevel.Medium => new(1600, 65),
        ImageCompressionLevel.High => new(1200, 50),
        ImageCompressionLevel.Extreme => new(900, 35),
        _ => new(int.MaxValue, 100)
    };

    private readonly record struct CompressionSettings(int MaxDimension, int Quality);
}
