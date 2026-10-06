using Microsoft.AspNetCore.Http;

namespace ILovePDF.Services;

/// <summary>Page caviardée : numéro (base 1), taille en points PDF et image aplatie (zones noires incluses).</summary>
public sealed record RedactedPage(int PageNumber, double WidthPoints, double HeightPoints, IFormFile Image);

public interface IPdfRedactionService
{
    bool IsValidPdfHeader(IFormFile file);

    Task<byte[]> ApplyRedactionsAsync(IFormFile originalPdf, IReadOnlyList<RedactedPage> redactedPages);
}
