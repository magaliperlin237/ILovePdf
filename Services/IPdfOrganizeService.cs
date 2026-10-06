using Microsoft.AspNetCore.Http;

namespace ILovePDF.Services;

/// <summary>Une page du résultat : numéro d'origine (base 1) et rotation supplémentaire en degrés (0, 90, 180, 270).</summary>
public sealed record PageOperation(int Page, int Rotate);

public interface IPdfOrganizeService
{
    /// <summary>
    /// Construit un nouveau PDF avec les pages demandées, dans l'ordre donné.
    /// Les pages absentes de la liste sont supprimées.
    /// </summary>
    /// <exception cref="ArgumentException">Liste invalide (le message est destiné à l'utilisateur).</exception>
    Task<byte[]> OrganizeAsync(IFormFile file, IReadOnlyList<PageOperation> operations);
}
