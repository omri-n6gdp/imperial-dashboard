#!/bin/bash
# crop.sh pdf page y0frac y1frac dpi [x0frac x1frac] -> prints base64 jpeg of that page region
pdf="$1"; p=$2; f0=$3; f1=$4; dpi=${5:-100}; g0=${6:-0}; g1=${7:-1}
read W H < <(pdfinfo -f $p -l $p "$pdf" | awk '/Page.*size/{print $4, $6; exit}')
read X Y PW PH < <(python3 -c "print(int($W*$dpi/72*$g0), int($H*$dpi/72*$f0), int($W*$dpi/72*($g1-$g0)), int($H*$dpi/72*($f1-$f0)))")
pdftoppm -f $p -l $p -r $dpi -gray -x $X -y $Y -W $PW -H $PH -jpeg -jpegopt quality=40 "$pdf" /tmp/crop >/dev/null
f=$(ls -t /tmp/crop*.jpg | head -1); base64 -w0 "$f"; rm -f /tmp/crop*.jpg
