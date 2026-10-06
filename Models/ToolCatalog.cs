namespace ILovePDF.Models;

/// <summary>Un outil affiché sur l'accueil et dans le menu.</summary>
/// <param name="Page">Chemin de la Razor Page, ex. "/PdfMerge".</param>
public sealed record Tool(string Title, string Description, string Icon, string Page);

public sealed record ToolCategory(string Name, string Icon, IReadOnlyList<Tool> Tools);

/// <summary>
/// Source unique de vérité : pour ajouter un outil, il suffit d'ajouter une ligne ici.
/// L'accueil et le menu de navigation se mettent à jour automatiquement.
/// </summary>
public static class ToolCatalog
{
    public static readonly IReadOnlyList<ToolCategory> Categories = new[]
    {
        new ToolCategory("Organiser", "bi-collection", new[]
        {
            new Tool("Fusionner des PDF", "Combinez plusieurs PDF en un seul document.", "bi-union", "/PdfMerge"),
            new Tool("Extraire des pages", "Récupérez une ou plusieurs pages dans un nouveau fichier.", "bi-scissors", "/PdfExtract"),
            new Tool("Organiser les pages", "Réordonnez, pivotez ou supprimez les pages par glisser-déposer.", "bi-grid-3x3-gap", "/PdfOrganize"),
            new Tool("Compresser un PDF", "Allégez votre PDF en recompressant ses images.", "bi-file-earmark-zip", "/PdfCompress"),
        }),
        new ToolCategory("Convertir", "bi-arrow-left-right", new[]
        {
            new Tool("Images → PDF", "Transformez vos images en un seul PDF, avec compression.", "bi-images", "/ImageToPdf"),
            new Tool("PDF → Images", "Exportez les pages d'un PDF en PNG ou JPEG.", "bi-file-earmark-image", "/PdfToImages"),
        }),
        new ToolCategory("Modifier", "bi-pencil-square", new[]
        {
            new Tool("Filigrane PDF", "Ajoutez un filigrane unique ou en mosaïque.", "bi-droplet", "/PdfWatermark"),
            new Tool("Signer un PDF", "Dessinez, tapez ou importez votre signature et placez-la sur le document.", "bi-vector-pen", "/PdfSign"),
            new Tool("Numéroter les pages", "Ajoutez une numérotation personnalisée en haut ou en bas.", "bi-123", "/PdfNumber"),
            new Tool("Éclaircir une image", "Éclaircissez au maximum et exportez en PDF, PNG, JPEG…", "bi-brightness-high", "/ImageBrighten"),
        }),
        new ToolCategory("Sécuriser", "bi-shield-lock", new[]
        {
            new Tool("Caviarder un PDF", "Masquez définitivement des informations sensibles.", "bi-eraser", "/PdfRedact"),
            new Tool("Protéger par mot de passe", "Chiffrez votre PDF et limitez impression, copie et modification.", "bi-lock", "/PdfProtect"),
        }),
        new ToolCategory("Analyser", "bi-search", new[]
        {
            new Tool("Comparer deux PDF", "Repérez les différences de texte et d'apparence.", "bi-layout-split", "/PdfCompare"),
        }),
    };

    public static IEnumerable<Tool> All => Categories.SelectMany(c => c.Tools);
}
