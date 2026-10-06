# PDF Tools

Boîte à outils PDF / images en ASP.NET Core 8 (Razor Pages + API), PDFsharp et ImageSharp.

## Organisation du code

| Dossier | Rôle |
| --- | --- |
| `Models/ToolCatalog.cs` | **Catalogue des outils** : alimente l'accueil et le menu |
| `Pages/` | Une page par outil (`PdfXxx.cshtml`) + l'accueil `Index.cshtml` |
| `Controllers/` | Une API REST par outil (`/api/pdf/...`, `/api/image/...`) : validation des entrées |
| `Services/` | Logique métier (`IXxxService` + `XxxService`) ; `PdfFileHelper` contient les utilitaires communs |
| `wwwroot/js/` | Un script par page (`pdf-xxx.js`) |
| `wwwroot/css/site.css` | Styles, regroupés par outil |

## Outils

| Catégorie | Outil | Page | API |
| --- | --- | --- | --- |
| Organiser | Fusionner | `/PdfMerge` | `POST /api/pdf/merge` |
| Organiser | Extraire des pages | `/PdfExtract` | `POST /api/pdf/extract` |
| Organiser | Organiser les pages | `/PdfOrganize` | `POST /api/pdf/organize` |
| Organiser | Compresser un PDF | `/PdfCompress` | `POST /api/pdf/compress` |
| Convertir | Images → PDF | `/ImageToPdf` | `POST /api/pdf/image-to-pdf` |
| Convertir | PDF → Images | `/PdfToImages` | *(dans le navigateur)* |
| Modifier | Filigrane | `/PdfWatermark` | `POST /api/pdf/watermark` |
| Modifier | Signer un PDF | `/PdfSign` | `POST /api/pdf/sign` |
| Modifier | Numéroter les pages | `/PdfNumber` | `POST /api/pdf/number` |
| Modifier | Éclaircir une image | `/ImageBrighten` | `POST /api/image/brighten` |
| Sécuriser | Caviarder | `/PdfRedact` | `POST /api/pdf/redact` |
| Sécuriser | Protéger par mot de passe | `/PdfProtect` | `POST /api/pdf/protect` |
| Analyser | Comparer | `/PdfCompare` | *(dans le navigateur)* |

## Ajouter un outil

1. Créer le service (`Services/IXxxService.cs`, `Services/XxxService.cs`) et l'enregistrer dans `Program.cs`.
2. Créer le contrôleur API (`Controllers/XxxApiController.cs`).
3. Créer la page (`Pages/Xxx.cshtml` + `.cshtml.cs`) et son script (`wwwroot/js/xxx.js`).
4. Ajouter **une ligne** dans `Models/ToolCatalog.cs` : l'outil apparaît tout seul sur l'accueil et dans le menu.

## Règles communes

- Taille maximale par fichier et nombre de fichiers : section `PdfSettings` de `appsettings.json`.
- Les messages d'erreur destinés à l'utilisateur sont levés en `ArgumentException` dans les services et renvoyés en `400` par les contrôleurs.
- Quand une logique existe en C# **et** en JavaScript (aperçu en direct), un commentaire `NB :` le signale : les deux versions doivent rester identiques.

## Notes sur les outils les plus délicats

- **Compression** : seules les images JPEG (`/DCTDecode`) sont recompressées (définition et qualité réduites selon le niveau). Le texte et les vecteurs ne sont pas modifiés ; si le résultat n'est pas plus léger, le fichier d'origine est renvoyé.
- **Signature** : signature *visuelle* (image apposée sur la page), sans valeur de signature électronique qualifiée. Les emplacements sont des fractions de la page affichée ; `PdfSignService` gère la rotation `/Rotate` des pages.
