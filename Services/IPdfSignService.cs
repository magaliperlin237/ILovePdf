using Microsoft.AspNetCore.Http;

namespace ILovePDF.Services;

/// <summary>
/// Emplacement d'une signature sur une page. Les valeurs sont des fractions (0 à 1) de la page
/// telle qu'elle est affichée (rotation incluse), l'origine étant en haut à gauche.
/// </summary>
public sealed record SignaturePlacement(int Page, double X, double Y, double Width, double Height);

public interface IPdfSignService
{
    /// <summary>Appose l'image de signature (PNG avec transparence) aux emplacements indiqués.</summary>
    /// <exception cref="ArgumentException">Paramètres invalides (le message est destiné à l'utilisateur).</exception>
    Task<byte[]> SignAsync(IFormFile pdf, IFormFile signature, IReadOnlyList<SignaturePlacement> placements);
}
