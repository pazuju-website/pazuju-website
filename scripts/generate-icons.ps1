param(
    [string]$LogoPath = "images\pazuju-logo.png",
    [string]$OutDir = "images\icons"
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$topColor = [System.Drawing.Color]::FromArgb(255, 0x6b, 0x36, 0x20)    # --wood-dark-1
$bottomColor = [System.Drawing.Color]::FromArgb(255, 0x43, 0x1f, 0x11) # --wood-dark-2

function New-IconImage {
    param(
        [int]$Size,
        [double]$LogoWidthFraction,
        [string]$OutPath
    )

    $bmp = New-Object System.Drawing.Bitmap $Size, $Size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $rect = New-Object System.Drawing.Rectangle 0, 0, $Size, $Size
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $topColor, $bottomColor, 90.0)
    $g.FillRectangle($brush, $rect)

    $logo = [System.Drawing.Image]::FromFile((Resolve-Path $LogoPath))
    $targetW = $Size * $LogoWidthFraction
    $targetH = $targetW * ($logo.Height / $logo.Width)
    $x = ($Size - $targetW) / 2
    $y = ($Size - $targetH) / 2
    $g.DrawImage($logo, $x, $y, $targetW, $targetH)
    $logo.Dispose()

    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}

# "any" icons: logo fills most of the square, safe for normal display
New-IconImage -Size 512 -LogoWidthFraction 0.72 -OutPath "$OutDir\icon-512.png"
New-IconImage -Size 192 -LogoWidthFraction 0.72 -OutPath "$OutDir\icon-192.png"
New-IconImage -Size 180 -LogoWidthFraction 0.72 -OutPath "$OutDir\apple-touch-icon.png"
New-IconImage -Size 32  -LogoWidthFraction 0.72 -OutPath "$OutDir\favicon-32.png"
New-IconImage -Size 16  -LogoWidthFraction 0.72 -OutPath "$OutDir\favicon-16.png"

# "maskable" icons: extra padding so the logo survives circular/squircle cropping (Android safe zone ~80% diameter)
New-IconImage -Size 512 -LogoWidthFraction 0.5 -OutPath "$OutDir\maskable-512.png"
New-IconImage -Size 192 -LogoWidthFraction 0.5 -OutPath "$OutDir\maskable-192.png"

Write-Output "Icons generated in $OutDir"
