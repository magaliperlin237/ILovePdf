using Microsoft.AspNetCore.Http;

namespace ILovePDF.Services;

/// <summary>Résultat : un PDF unique, ou une archive ZIP (un PDF par page).</summary>
public sealed record PdfExtractResult(byte[] Bytes, string ContentType, string FileName);

public interface IPdfExtractService
{
    bool IsValidPdfHeader(IFormFile file);

    /// <summary>
    /// Extrait des pages d'un PDF.
    /// </summary>
    /// <param name="file">PDF d'origine.</param>
    /// <param name="pagesSpec">Pages à extraire, ex. « 1,3,5-8 » (numéros à partir de 1).</param>
    /// <param name="separate">false : un seul PDF ; true : un PDF par page, dans une archive ZIP.</param>
    /// <exception cref="ArgumentException">Sélection de pages invalide (le message est destiné à l'utilisateur).</exception>
    Task<PdfExtractResult> ExtractAsync(IFormFile file, string pagesSpec, bool separate);
}
