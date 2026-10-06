using Microsoft.AspNetCore.Http;

namespace ILovePDF.Services;

/// <param name="UserPassword">Mot de passe demandé pour ouvrir le document.</param>
/// <param name="OwnerPassword">Mot de passe propriétaire (lève les restrictions). Généré aléatoirement s'il est vide.</param>
public sealed record PdfProtectOptions(string UserPassword, string? OwnerPassword, bool AllowPrint, bool AllowCopy, bool AllowModify);

public interface IPdfProtectService
{
    /// <exception cref="ArgumentException">Paramètres invalides (le message est destiné à l'utilisateur).</exception>
    Task<byte[]> ProtectAsync(IFormFile file, PdfProtectOptions options);
}
