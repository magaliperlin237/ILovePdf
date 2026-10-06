using Microsoft.AspNetCore.Http;

namespace ILovePDF.Services;

public enum PdfCompressionLevel
{
    Low,
    Medium,
    High,
    Extreme
}

/// <param name="Bytes">PDF compressé, ou PDF d'origine inchangé si la compression n'apporte aucun gain.</param>
/// <param name="ImagesTotal">Nombre d'images trouvées dans le document.</param>
/// <param name="ImagesOptimized">Nombre d'images effectivement recompressées.</param>
public sealed record PdfCompressResult(byte[] Bytes, int ImagesTotal, int ImagesOptimized);

public interface IPdfCompressService
{
    Task<PdfCompressResult> CompressAsync(IFormFile file, PdfCompressionLevel level);
}
