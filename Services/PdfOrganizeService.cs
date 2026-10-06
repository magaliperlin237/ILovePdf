using Microsoft.AspNetCore.Http;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;

namespace ILovePDF.Services;

public sealed class PdfOrganizeService : IPdfOrganizeService
{
    private const int MaxOperations = 5000;
    private static readonly int[] AllowedRotations = { 0, 90, 180, 270 };

    public async Task<byte[]> OrganizeAsync(IFormFile file, IReadOnlyList<PageOperation> operations)
    {
        if (operations == null || operations.Count == 0)
            throw new ArgumentException("Le document final doit contenir au moins une page.");

        if (operations.Count > MaxOperations)
            throw new ArgumentException("Trop de pages demandées.");

        await using var input = new MemoryStream();
        await file.CopyToAsync(input);
        input.Position = 0;

        using var source = PdfReader.Open(input, PdfDocumentOpenMode.Import);

        var seen = new HashSet<int>();
        foreach (var op in operations)
        {
            if (op.Page < 1 || op.Page > source.PageCount)
                throw new ArgumentException($"La page {op.Page} n'existe pas : le document contient {source.PageCount} page(s).");

            if (!AllowedRotations.Contains(op.Rotate))
                throw new ArgumentException("Rotation invalide (valeurs acceptées : 0, 90, 180, 270).");

            if (!seen.Add(op.Page))
                throw new ArgumentException($"La page {op.Page} apparaît plusieurs fois.");
        }

        using var output = new PdfDocument();
        foreach (var op in operations)
        {
            var added = output.AddPage(source.Pages[op.Page - 1]);
            if (op.Rotate != 0)
                added.Rotate = (added.Rotate + op.Rotate) % 360;
        }

        using var stream = new MemoryStream();
        output.Save(stream, false);
        return stream.ToArray();
    }
}
