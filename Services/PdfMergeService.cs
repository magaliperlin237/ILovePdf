using Microsoft.AspNetCore.Http;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection.PortableExecutable;
using System.Text;
using System.Threading.Tasks;

namespace ILovePDF.Services;

public class PdfMergeService : IPdfMergeService
{
    private static readonly byte[] PdfHeader = Encoding.ASCII.GetBytes("%PDF-");

    public bool IsValidPdfHeader(IFormFile file)
    {
        if (file == null || file.Length < 5)
            return false;

        using var stream = file.OpenReadStream();
        var buffer = new byte[5];
        var readBytes = stream.Read(buffer, 0, 5);

        if (readBytes < 5)
            return false;

        for (int i = 0; i < 5; i++)
        {
            if (buffer[i] != PdfHeader[i])
                return false;
        }

        return true;
    }

    public async Task<byte[]> MergePdfsAsync(IReadOnlyList<IFormFile> files)
    {
        using var outputDocument = new PdfDocument();

        foreach (var file in files)
        {
            using var inputStream = new MemoryStream();
            await file.CopyToAsync(inputStream);
            inputStream.Position = 0;

            using var inputDocument = PdfReader.Open(inputStream, PdfDocumentOpenMode.Import);
            int count = inputDocument.PageCount;
            for (int idx = 0; idx < count; idx++)
            {
                PdfPage page = inputDocument.Pages[idx];
                outputDocument.AddPage(page);
            }
        }

        using var outputStream = new MemoryStream();
        outputDocument.Save(outputStream, false);
        return outputStream.ToArray();
    }
}