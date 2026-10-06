using ILovePDF.Models;
using ILovePDF.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using System.Text.Json;

namespace ILovePDF.Controllers;

[ApiController]
[Route("api/pdf")]
public sealed class PdfOrganizeApiController : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    private readonly IPdfOrganizeService _service;
    private readonly PdfSettings _settings;
    private readonly ILogger<PdfOrganizeApiController> _logger;

    public PdfOrganizeApiController(IPdfOrganizeService service, IOptions<PdfSettings> settings, ILogger<PdfOrganizeApiController> logger)
    {
        _service = service;
        _settings = settings.Value;
        _logger = logger;
    }

    /// <param name="operations">JSON : [{"page":3,"rotate":90},{"page":1,"rotate":0}] — l'ordre du tableau est l'ordre final.</param>
    [HttpPost("organize")]
    [RequestSizeLimit(104_857_600)]
    public async Task<IActionResult> Organize([FromForm] IFormFile file, [FromForm] string operations)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "Veuillez sélectionner un fichier PDF." });

        if (file.Length > _settings.MaxFileSizeBytes)
            return BadRequest(new { message = $"Le fichier dépasse la taille maximale de {_settings.MaxFileSizeMb} Mo." });

        if (!PdfFileHelper.IsValidPdfHeader(file))
            return BadRequest(new { message = "Le fichier n'est pas un PDF valide." });

        List<PageOperation>? ops;
        try
        {
            ops = JsonSerializer.Deserialize<List<PageOperation>>(operations ?? "[]", JsonOptions);
        }
        catch (JsonException)
        {
            return BadRequest(new { message = "La liste des pages est invalide." });
        }

        try
        {
            var bytes = await _service.OrganizeAsync(file, ops ?? new List<PageOperation>());
            return File(bytes, "application/pdf", $"{PdfFileHelper.SafeBaseName(file.FileName)}_organise.pdf");
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (PdfSharp.Pdf.IO.PdfReaderException ex)
        {
            _logger.LogWarning(ex, "Organisation : PDF invalide ou protégé.");
            return BadRequest(new { message = "Le fichier PDF ne peut pas être traité. Vérifiez qu'il n'est pas corrompu ou protégé par mot de passe." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Organisation : erreur inattendue.");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "Une erreur est survenue lors de la réorganisation du PDF." });
        }
    }
}
