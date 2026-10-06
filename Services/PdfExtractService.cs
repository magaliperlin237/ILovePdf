using Microsoft.AspNetCore.Http;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;
using System.IO.Compression;
using System.Text;

namespace ILovePDF.Services;

public sealed class PdfExtractService : IPdfExtractService
{
    private static readonly byte[] PdfHeader = Encoding.ASCII.GetBytes("%PDF-");

    public bool IsValidPdfHeader(IFormFile file)
    {
        if (file == null || file.Length < 5)
            return false;

        using var stream = file.OpenReadStream();
        var buffer = new byte[5];
        var read = stream.Read(buffer, 0, 5);
        return read == 5 && buffer.SequenceEqual(PdfHeader);
    }

    public async Task<PdfExtractResult> ExtractAsync(IFormFile file, string pagesSpec, bool separate)
    {
        await using var input = new MemoryStream();
        await file.CopyToAsync(input);
        input.Position = 0;

        using var source = PdfReader.Open(input, PdfDocumentOpenMode.Import);
        var pages = ParsePages(pagesSpec, source.PageCount);
        var baseName = SanitizeFileName(Path.GetFileNameWithoutExtension(file.FileName));

        if (!separate)
        {
            using var output = new PdfDocument();
            foreach (var number in pages)
                output.AddPage(source.Pages[number - 1]);

            using var stream = new MemoryStream();
            output.Save(stream, false);
            return new PdfExtractResult(stream.ToArray(), "application/pdf", $"{baseName}_extrait.pdf");
        }

        var digits = source.PageCount.ToString().Length;
        using var zipStream = new MemoryStream();
        using (var zip = new ZipArchive(zipStream, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var number in pages)
            {
                using var single = new PdfDocument();
                single.AddPage(source.Pages[number - 1]);

                using var pageStream = new MemoryStream();
                single.Save(pageStream, false);

                var entry = zip.CreateEntry($"{baseName}_page_{number.ToString().PadLeft(digits, '0')}.pdf", CompressionLevel.Fastest);
                await using var entryStream = entry.Open();
                await entryStream.WriteAsync(pageStream.ToArray());
            }
        }

        return new PdfExtractResult(zipStream.ToArray(), "application/zip", $"{baseName}_pages.zip");
    }

    /// <summary>
    /// Analyse « 1,3,5-8 » et renvoie les numéros de page, triés et sans doublon.
    /// </summary>
    internal static List<int> ParsePages(string? spec, int pageCount)
    {
        if (string.IsNullOrWhiteSpace(spec))
            throw new ArgumentException("Indiquez au moins une page à extraire.");

        var selected = new SortedSet<int>();
        var tokens = spec.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        foreach (var token in tokens)
        {
            var parts = token.Split('-', StringSplitOptions.TrimEntries);

            if (parts.Length == 1 && int.TryParse(parts[0], out var single))
            {
                CheckRange(single, pageCount);
                selected.Add(single);
            }
            else if (parts.Length == 2 && int.TryParse(parts[0], out var start) && int.TryParse(parts[1], out var end))
            {
                if (start > end)
                    throw new ArgumentException($"L'intervalle « {token} » est inversé (écrivez {end}-{start}).");

                CheckRange(start, pageCount);
                CheckRange(end, pageCount);
                for (var p = start; p <= end; p++)
                    selected.Add(p);
            }
            else
            {
                throw new ArgumentException($"« {token} » n'est pas une sélection de pages valide. Exemple : 1,3,5-8.");
            }
        }

        if (selected.Count == 0)
            throw new ArgumentException("Indiquez au moins une page à extraire.");

        return selected.ToList();
    }

    private static void CheckRange(int page, int pageCount)
    {
        if (page < 1 || page > pageCount)
            throw new ArgumentException($"La page {page} n'existe pas : le document contient {pageCount} page(s).");
    }

    private static string SanitizeFileName(string name)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var clean = new string(name.Where(c => !invalid.Contains(c)).ToArray()).Trim();
        return string.IsNullOrWhiteSpace(clean) ? "document" : clean;
    }
}
