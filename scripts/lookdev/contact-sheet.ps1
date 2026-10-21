# Contact sheet for the lamp agent options: A to D side by side, labelled in the margin only (never on the image).
# Windows PowerShell, System.Drawing only. Usage: powershell -ExecutionPolicy Bypass -File scripts/lookdev/contact-sheet.ps1 [-Dir apps/vr/ArtSource/lamp-agent/options]
param([string]$Dir = (Join-Path $PSScriptRoot '../../apps/vr/ArtSource/lamp-agent/options'))
Add-Type -AssemblyName System.Drawing
$Dir = (Resolve-Path $Dir).Path
$cell = 512; $margin = 48; $gap = 12
$names = 'A', 'B', 'C', 'D'
$w = $gap + $names.Count * ($cell + $gap)
$h = $margin + $cell + $gap
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(24, 28, 38))
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$font = New-Object System.Drawing.Font 'Segoe UI', 22, ([System.Drawing.FontStyle]::Bold)
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(235, 235, 235))
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = [System.Drawing.StringAlignment]::Center
$fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
for ($i = 0; $i -lt $names.Count; $i++) {
  $x = $gap + $i * ($cell + $gap)
  $img = [System.Drawing.Image]::FromFile((Join-Path $Dir ($names[$i] + '.png')))
  $g.DrawImage($img, $x, $margin, $cell, $cell)
  $img.Dispose()
  $g.DrawString($names[$i], $font, $brush, (New-Object System.Drawing.RectangleF $x, 0, $cell, $margin), $fmt)
}
$out = Join-Path $Dir 'contact.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output ("{0} {1} bytes" -f $out, (Get-Item $out).Length)
