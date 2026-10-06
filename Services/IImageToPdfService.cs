using Microsoft.AspNetCore.Http;

namespace ILovePDF.Services;

public interface IImageToPdfService
{
    bool IsSupportedImage(IFormFile file);

    Task<byte[]> ConvertToPdfAsync(
        IReadOnlyList<IFormFile> files,
        ImageCompressionLevel compressionLevel = ImageCompressionLevel.None,
        WatermarkOptions? watermark = null);
}

public enum ImageCompressionLevel
{
    None,
    Low,
    Medium,
    High,
    Extreme
}


public sealed record WatermarkOptions(
    string Text,
    int Opacity,
    int FontSize,
    string Position);
