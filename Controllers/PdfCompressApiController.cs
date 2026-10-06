using ILovePDF.Models;
using ILovePDF.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace ILovePDF.Controllers;

[ApiController]
[Route("api/pdf")]
public sealed class PdfCompressApiController : ControllerBase
{
    private readonly IPdfCompressService _service;
    private readonly PdfSettings _settings;
    private readonly ILogger<PdfCompressApiController> _logger;

    public PdfCompressApiController(IPdfCompressService service, IOptions<PdfSettings> settings, ILogger<PdfCompressApiController> logger)
    {
        _service = service;
        _settings = settings.Value;
        _logger = logger;
    }

    /// <param name="level">low, medium, high ou extreme.</param>
    [HttpPost("compress")]
    [RequestSizeLimit(104_857_600)]
    public async Task<IActionResult> Compress([FromForm] IFormFile file, [FromForm] string level = "medium")
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "Veuillez sélectionner un fichier PDF." });

        if (file.Length > _settings.MaxFileSizeBytes)
            return BadRequest(new { message = $"Le fichier dépasse la taille maximale de {_settings.MaxFileSizeMb} Mo." });

        if (!PdfFileHelper.IsValidPdfHeader(file))
            return BadRequest(new { message = "Le fichier n'est pas un PDF valide." });

        if (!Enum.TryParse<PdfCompressionLevel>(level, ignoreCase: true, out var parsedLevel) || !Enum.IsDefined(parsedLevel))
            return BadRequest(new { message = "Le niveau de compression est invalide." });

        try
        {
            var result = await _service.CompressAsync(file, parsedLevel);
            Response.Headers["X-Images-Total"] = result.ImagesTotal.ToString();
            Response.Headers["X-Images-Optimized"] = result.ImagesOptimized.ToString();
            return File(result.Bytes, "application/pdf", $"{PdfFileHelper.SafeBaseName(file.FileName)}_compresse.pdf");
        }
        catch (PdfSharp.Pdf.IO.PdfReaderException ex)
        {
            _logger.LogWarning(ex, "Compression : PDF invalide ou protégé.");
            return BadRequest(new { message = "Le fichier PDF ne peut pas être traité. Vérifiez qu'il n'est pas corrompu ou protégé par mot de passe." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Compression : erreur inattendue.");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "Une erreur est survenue lors de la compression du PDF." });
        }
    }
}
