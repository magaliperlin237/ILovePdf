using Microsoft.AspNetCore.Http;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;
using System.Text;

namespace ILovePDF.Services;

/// <summary>
/// Caviardage définitif : les pages contenant des zones à masquer sont remplacées par une image
/// déjà aplatie côté navigateur (les rectangles noirs sont dessinés dans les pixels).
/// Le texte et les objets situés sous les rectangles n'existent donc plus dans le fichier final.
/// Les autres pages sont importées telles quelles.
/// </summary>
public sealed class PdfRedactionService : IPdfRedactionService
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

    public async Task<byte[]> ApplyRedactionsAsync(IFormFile originalPdf, IReadOnlyList<RedactedPage> redactedPages)
    {
        if (redactedPages == null || redactedPages.Count == 0)
            throw new ArgumentException("Aucune zone à caviarder.");

        await using var input = new MemoryStream();
        await originalPdf.CopyToAsync(input);
        input.Position = 0;

        using var source = PdfReader.Open(input, PdfDocumentOpenMode.Import);
        var byPage = redactedPages.ToDictionary(p => p.PageNumber);

        foreach (var number in byPage.Keys)
        {
            if (number < 1 || number > source.PageCount)
                throw new ArgumentException($"Numéro de page invalide : {number}.");
        }

        // Les flux d'images doivent rester ouverts jusqu'à document.Save() (lecture différée de PDFsharp).
        var streams = new List<MemoryStream>();
        var images = new List<XImage>();

        try
        {
            // Nouveau document : on ne recopie ni métadonnées, ni pièces jointes, ni signets de l'original.
            using var output = new PdfDocument();
            output.Info.Title = string.Empty;

            for (int i = 0; i < source.PageCount; i++)
            {
                if (!byPage.TryGetValue(i + 1, out var redacted))
                {
                    output.AddPage(source.Pages[i]);
                    continue;
                }

                var ms = new MemoryStream();
                streams.Add(ms);
                await using (var s = redacted.Image.OpenReadStream())
                    await s.CopyToAsync(ms);
                ms.Position = 0;

                var image = XImage.FromStream(ms);
                images.Add(image);

                var page = output.AddPage();
                page.Width = XUnit.FromPoint(redacted.WidthPoints);
                page.Height = XUnit.FromPoint(redacted.HeightPoints);

                using var gfx = XGraphics.FromPdfPage(page);
                gfx.DrawImage(image, 0, 0, redacted.WidthPoints, redacted.HeightPoints);
            }

            using var result = new MemoryStream();
            output.Save(result, false);
            return result.ToArray();
        }
        finally
        {
            foreach (var image in images) image.Dispose();
            foreach (var stream in streams) stream.Dispose();
        }
    }
}
