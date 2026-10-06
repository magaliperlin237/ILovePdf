using Microsoft.AspNetCore.Http;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;

namespace ILovePDF.Services;

public sealed class PdfProtectService : IPdfProtectService
{
    public async Task<byte[]> ProtectAsync(IFormFile file, PdfProtectOptions options)
    {
        if (string.IsNullOrEmpty(options.UserPassword))
            throw new ArgumentException("Le mot de passe est obligatoire.");

        if (options.UserPassword.Length > 128 || (options.OwnerPassword?.Length ?? 0) > 128)
            throw new ArgumentException("Les mots de passe ne peuvent pas dépasser 128 caractères.");

        // Sans mot de passe propriétaire distinct, les restrictions pourraient être levées avec le mot de passe d'ouverture.
        var owner = string.IsNullOrEmpty(options.OwnerPassword)
            ? Convert.ToHexString(Guid.NewGuid().ToByteArray())
            : options.OwnerPassword;

        await using var input = new MemoryStream();
        await file.CopyToAsync(input);
        input.Position = 0;

        using var document = PdfReader.Open(input, PdfDocumentOpenMode.Modify);

        var security = document.SecuritySettings;
        security.UserPassword = options.UserPassword;
        security.OwnerPassword = owner;

        security.PermitPrint = options.AllowPrint;
        security.PermitFullQualityPrint = options.AllowPrint;
        security.PermitExtractContent = options.AllowCopy;
        security.PermitModifyDocument = options.AllowModify;
        security.PermitAnnotations = options.AllowModify;
        security.PermitAssembleDocument = options.AllowModify;
        security.PermitFormsFill = options.AllowModify;

        using var output = new MemoryStream();
        document.Save(output, false);
        return output.ToArray();
    }
}
