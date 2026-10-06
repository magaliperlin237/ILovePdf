using Microsoft.AspNetCore.Http;

namespace ILovePDF.Services;

/// <param name="Position">top-left, top-center, top-right, bottom-left, bottom-center, bottom-right.</param>
/// <param name="Format">n (« 3 »), dash (« - 3 - »), page-n (« Page 3 »), n-total (« 3 / 10 »), page-n-total (« Page 3 sur 10 »).</param>
/// <param name="Start">Numéro affiché sur la première page numérotée.</param>
/// <param name="SkipFirst">Ne pas numéroter la première page (page de garde).</param>
/// <param name="FontSize">Taille de police en points.</param>
/// <param name="Color">Couleur hexadécimale (#RRGGBB).</param>
public sealed record PageNumberOptions(string Position, string Format, int Start, bool SkipFirst, double FontSize, string Color);

public interface IPdfPageNumberService
{
    /// <exception cref="ArgumentException">Paramètres invalides (le message est destiné à l'utilisateur).</exception>
    Task<byte[]> AddPageNumbersAsync(IFormFile file, PageNumberOptions options);
}
