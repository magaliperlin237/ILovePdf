using ILovePDF.Models;
using ILovePDF.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace ILovePDF.Controllers;

[ApiController]
[Route("api/pdf")]
public class PdfApiController : ControllerBase
{
    private readonly IPdfMergeService _pdfMergeService;
    private readonly PdfSettings _pdfSettings;

    public PdfApiController(IPdfMergeService pdfMergeService, IOptions<PdfSettings> pdfSettings)
    {
        _pdfMergeService = pdfMergeService;
        _pdfSettings = pdfSettings.Value;
    }

    [HttpPost("merge")]
    [RequestSizeLimit(104_857_600)] // Limit max request body to 100 Mo
    public async Task<IActionResult> Merge([FromForm] List<IFormFile> files)
    {
        if (files == null || files.Count < 2)
        {
            return BadRequest(new { message = "Veuillez sélectionner au moins deux fichiers PDF." });
        }

        if (files.Count > _pdfSettings.MaxFiles)
        {
            return BadRequest(new { message = $"Vous ne pouvez pas envoyer plus de {_pdfSettings.MaxFiles} fichiers." });
        }

        foreach (var file in files)
        {
            if (file.Length > _pdfSettings.MaxFileSizeBytes)
            {
                return BadRequest(new { message = $"Le fichier '{file.FileName}' dépasse la taille maximale autorisée de {_pdfSettings.MaxFileSizeMb} Mo." });
            }

            if (!_pdfMergeService.IsValidPdfHeader(file))
            {
                return BadRequest(new { message = $"Le fichier '{file.FileName}' n'est pas un fichier PDF valide." });
            }
        }

        try
        {
            byte[] mergedPdfBytes = await _pdfMergeService.MergePdfsAsync(files);
            string downloadFileName = $"fusion_pdftools_{DateTime.Now:yyyyMMddHHmmss}.pdf";

            return File(mergedPdfBytes, "application/pdf", downloadFileName);
        }
        catch (Exception)
        {
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "Une erreur est survenue lors de la fusion des fichiers PDF." });
        }
    }
}