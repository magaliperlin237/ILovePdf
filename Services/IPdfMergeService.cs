using Microsoft.AspNetCore.Http;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace ILovePDF.Services;

public interface IPdfMergeService
{
    Task<byte[]> MergePdfsAsync(IReadOnlyList<IFormFile> files);
    bool IsValidPdfHeader(IFormFile file);
}