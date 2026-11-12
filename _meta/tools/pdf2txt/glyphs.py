# Glyph-name and TeX-encoding tables for decoding maths fonts.
import re
from pdfminer.encodingdb import name2unicode as _n2u

GREEK_UC = "ΓΔΘΛΞΠΣΥΦΨΩ"
OML = {i: c for i, c in enumerate(GREEK_UC)}
OML.update({11+i: c for i, c in enumerate("αβγδϵζηθικλμνξπρστυϕχψωεϑϖϱςφ")})
OML.update({40:'↼',41:'↽',42:'⇀',43:'⇁',44:'',45:'',46:'▷',47:'◁'})
OML.update({48+i: str(i) for i in range(10)})
OML.update({58:'.',59:',',60:'<',61:'/',62:'>',63:'⋆',64:'∂',91:'♭',92:'♮',93:'♯',94:'⌣',95:'⌢',96:'ℓ',123:'ı',124:'ȷ',125:'℘',126:'⃗',127:'͡'})
OML.update({65+i: chr(65+i) for i in range(26)}); OML.update({97+i: chr(97+i) for i in range(26)})
SCRIPT = "𝒜ℬ𝒞𝒟ℰℱ𝒢ℋℐ𝒥𝒦ℒℳ𝒩𝒪𝒫𝒬ℛ𝒮𝒯𝒰𝒱𝒲𝒳𝒴𝒵"
OMS = dict(enumerate("−·×∗÷⋄±∓⊕⊖⊗⊘⊙◯∘•≍≡⊆⊇≤≥⪯⪰∼≈⊂⊃≪≫≺≻←→↑↓↔↗↘≃⇐⇒⇑⇓⇔↖↙∝′∞∈∋△▽/↦∀∃¬∅ℜℑ⊤⊥ℵ"))
OMS.update({65+i: c for i, c in enumerate(SCRIPT)})
OMS.update({91+i: c for i, c in enumerate("∪∩⊎∧∨⊢⊣⌊⌋⌈⌉{}⟨⟩|‖↕⇕\\≀√⨿∇∫⊔⊓⊑⊒§†‡¶♣♢♡♠")})
OMX = {}
for base, chars in ((0, "()[]⌊⌋⌈⌉{}⟨⟩|‖/\\"), (16, "()()[]⌊⌋⌈⌉{}⟨⟩/\\"), (32, "()[]⌊⌋⌈⌉{}⟨⟩/\\/\\"),
                    (48, "⎛⎞⎡⎤⎣⎦⎢⎥⎧⎫⎩⎭⎨⎬⎪⏐⎝⎠⎜⎟⟨⟩⊔⊔∮∮⊙⊙⊕⊕⊗⊗∑∏∫⋃⋂⊎∧∨∑∏∫⋃⋂⊎∧∨∐∐^^^~~~[]⌊⌋⌈⌉{}√√√√√⎷┌‖↑↓┐┘⇑⇓")):
    for i, c in enumerate(chars):
        OMX[base+i] = c
OT1 = {i: c for i, c in enumerate(GREEK_UC)}
OT1.update({11:'ff',12:'fi',13:'fl',14:'ffi',15:'ffl',16:'ı',17:'ȷ',18:'`',19:'´',20:'ˇ',21:'˘',22:'¯',23:'˚',24:'¸',25:'ß',26:'æ',27:'œ',28:'ø',29:'Æ',30:'Œ',31:'Ø',32:'',34:'”',60:'¡',62:'¿',92:'“',94:'ˆ',95:'˙',123:'–',124:'—',125:'˝',126:'˜',127:'¨'})
for i in range(33, 127):
    OT1.setdefault(i, chr(i))
OT1[39] = '’'; OT1[96] = '‘'

SYMBOL = {0x20:' ',0x21:'!',0x22:'∀',0x23:'#',0x24:'∃',0x25:'%',0x26:'&',0x27:'∋',0x28:'(',0x29:')',0x2a:'∗',0x2b:'+',0x2c:',',0x2d:'−',0x2e:'.',0x2f:'/',
          0x3a:':',0x3b:';',0x3c:'<',0x3d:'=',0x3e:'>',0x3f:'?',0x40:'≅'}
SYMBOL.update({0x41+i: c for i, c in enumerate("ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ")})
SYMBOL.update({0x5b:'[',0x5c:'∴',0x5d:']',0x5e:'⊥',0x5f:'_',0x60:'‾'})
SYMBOL.update({0x61+i: c for i, c in enumerate("αβχδεφγηιϕκλμνοπθρστυϖωξψζ")})
SYMBOL.update({0x7b:'{',0x7c:'|',0x7d:'}',0x7e:'∼'})
SYMBOL.update({0xa1+i: c for i, c in enumerate("ϒ′≤⁄∞ƒ♣♦♥♠↔←↑→↓°±″≥×∝∂•÷≠≡≈…|—↵ℵℑℜ℘⊗⊕∅∩∪⊃⊇⊄⊂⊆∈∉∠∇®©™∏√⋅¬∧∨⇔⇐⇑⇒⇓◊⟨®©™∑⎛⎜⎝⎡⎢⎣⎧⎨⎩⎪")})
SYMBOL.update({0xf1+i: c for i, c in enumerate("⟩∫⌠⎮⌡⎞⎟⎠⎤⎥⎦⎫⎬⎭")})
for i in range(10):
    SYMBOL[0x30+i] = str(i)
APPLE_PUA = {0xF8E5+i: c for i, c in enumerate("‾|—®©™⎛⎜⎝⎡⎢⎣⎧⎨⎩⎪⎮⎞⎟⎠⎤⎥⎦⎫⎬⎭")}


def fix_pua(s):
    out = []
    for ch in s:
        o = ord(ch)
        if 0xF020 <= o <= 0xF0FE and (o - 0xF000) in SYMBOL:
            out.append(SYMBOL[o - 0xF000])
        elif o in APPLE_PUA:
            out.append(APPLE_PUA[o])
        else:
            out.append(ch)
    return ''.join(out)


_T = """minus − multiply × divide ÷ periodcentered · dotmath ⋅ asteriskmath ∗ plusminus ± minusplus ∓ circleplus ⊕ circleminus ⊖
circlemultiply ⊗ circledivide ⊘ circledot ⊙ circlecopyrt ◯ openbullet ∘ bullet • equivasymptotic ≍ equivalence ≡ reflexsubset ⊆
reflexsuperset ⊇ lessequal ≤ greaterequal ≥ precedesequal ⪯ followsequal ⪰ similar ∼ approxequal ≈ propersubset ⊂ propersuperset ⊃
lessmuch ≪ greatermuch ≫ precedes ≺ follows ≻ arrowleft ← arrowright → arrowup ↑ arrowdown ↓ arrowboth ↔ arrownortheast ↗
arrowsoutheast ↘ similarequal ≃ arrowdblleft ⇐ arrowdblright ⇒ arrowdblup ⇑ arrowdbldown ⇓ arrowdblboth ⇔ arrownorthwest ↖
arrowsouthwest ↙ proportional ∝ prime ′ infinity ∞ element ∈ owner ∋ triangle △ triangleinv ▽ negationslash / mapsto ↦ universal ∀
existential ∃ logicalnot ¬ emptyset ∅ Rfractur ℜ Ifractur ℑ latticetop ⊤ perpendicular ⊥ aleph ℵ union ∪ intersection ∩ unionmulti ⊎
logicaland ∧ logicalor ∨ turnstileleft ⊢ turnstileright ⊣ floorleft ⌊ floorright ⌋ ceilingleft ⌈ ceilingright ⌉ angbracketleft ⟨
angbracketright ⟩ bardbl ‖ arrowbothv ↕ arrowdblbothv ⇕ wreathproduct ≀ radical √ coproduct ⨿ nabla ∇ integral ∫ unionsq ⊔
intersectionsq ⊓ subsetsqequal ⊑ supersetsqequal ⊒ club ♣ diamond ♢ heart ♡ spade ♠ diamondmath ⋄ partialdiff ∂ partial ∂
planckover2pi ħ planckover2pi1 ℏ hbar ħ hslash ℏ lscript ℓ weierstrass ℘ dotlessi ı dotlessj ȷ flat ♭ natural ♮ sharp ♯
slurbelow ⌣ slurabove ⌢ star ⋆ triangleright ▷ triangleleft ◁ nequal ≠ notequal ≠ therefore ∴ because ∵ lessorequalslant ⩽
greaterorequalslant ⩾ lessorsimilar ≲ greaterorsimilar ≳ harpoonleftright ⇌ harpoonrightleft ⇌ harpoonleftup ↼ harpoonleftdown ↽
harpoonrightup ⇀ harpoonrightdown ⇁ epsilon1 ε theta1 ϑ pi1 ϖ rho1 ϱ sigma1 ς phi1 φ omega1 ϖ epsilon ϵ phi ϕ visiblespace ␣
dotaccent ˙ ring ˚ circumflex ˆ tilde ˜ macron ¯ breve ˘ caron ˇ hungarumlaut ˝ dieresis ¨ acute ´ grave ` cedilla ¸ ogonek ˛
quotedblleft “ quotedblright ” arrowhookleft ↩ arrowhookright ↪ longarrowright ⟶ longarrowleft ⟵ defines ≔ colonequal ≔ checkmark ✓
square □ squaresolid ■ lozenge ◊ angle ∠ degree ° ff ff fi fi fl fl ffi ffi ffl ffl vextendsingle | vextenddouble ‖ contintegral ∮
summation ∑ product ∏ radicalvertex √ radicalbt √ hatwide ^ tildewide ~ slash / braceleft { braceright } bracketleft [
bracketright ] parenleft ( parenright ) bar | parenlefttp ⎛ parenleftex ⎜ parenleftbt ⎝ parenrighttp ⎞ parenrightex ⎟ parenrightbt ⎠
bracketlefttp ⎡ bracketleftex ⎢ bracketleftbt ⎣ bracketrighttp ⎤ bracketrightex ⎥ bracketrightbt ⎦ bracelefttp ⎧ braceleftmid ⎨
braceleftbt ⎩ braceex ⎪ bracerighttp ⎫ bracerightmid ⎬ bracerightbt ⎭ arrowvertex ⏐ arrowdblvertex ‖ uniontext ⋃
intersectiontext ⋂ logicalandtext ⋀ logicalortext ⋁ ell ℓ complement ∁ dagger † daggerdbl ‡ section § paragraph ¶"""
TEXNAMES = {}
_toks = _T.split()
for _i in range(0, len(_toks), 2):
    TEXNAMES[_toks[_i]] = _toks[_i+1]
TEXNAMES['backslash'] = '\\'
TEXNAMES.update({'trianglesolid': '▲', 'triangledownsld': '▼', 'trianglerightsld': '▶', 'triangleleftsld': '◀',
                 'squaresolid': '■', 'circlesolid': '●'})
TEXNAMES['vector'] = '⃗'
TEXNAMES['tie'] = '͡'

GENERIC = re.compile(r'^(g|a|glyph|cid|index|c|G|char|orn|C|T)\d*$|^\.notdef$|^space$')
SUFFIXES = ('sf', '.alt', '.sl', '.ss01', '.ss02', '.it', '.up', 'up', '.bold', 'bold', '.smcp', '.sc', '.var', '.osf',
            '.lf', '.tosf', '.tf', '.sup', '.inf', '.short', '.st')
SIZESUF = re.compile(r'(text|display|display2|text2|big|Big|bigg|Bigg|bigger|biggest)$')
BB = {'R': 'ℝ', 'C': 'ℂ', 'Z': 'ℤ', 'N': 'ℕ', 'Q': 'ℚ', 'P': 'ℙ', 'H': 'ℍ'}


def name_to_unicode(name):
    if not name or name in ('.notdef', 'space'):
        return None
    if name in TEXNAMES:
        return TEXNAMES[name]
    if GENERIC.match(name):
        return None
    if '_' in name and not name.startswith('uni'):
        parts = [name_to_unicode(p) for p in name.split('_')]
        if all(parts):
            return ''.join(parts)
    try:
        u = _n2u(name)
        if u:
            return fix_pua(u)
    except Exception:
        pass
    for suf in SUFFIXES:
        if name.endswith(suf) and len(name) > len(suf):
            u = name_to_unicode(name[:-len(suf)])
            if u:
                return u
    m = SIZESUF.search(name)
    if m and len(name) > len(m.group(0)):
        u = name_to_unicode(name[:-len(m.group(0))])
        if u:
            return u
    if re.fullmatch(r'[A-Za-z]1', name):
        return BB.get(name[0], name[0])
    if '.' in name.strip('.'):
        return name_to_unicode(name.split('.')[0])
    return None


FAMILY_PATTERNS = [
    ('OMX', re.compile(r'(cmex|txex|pxex|lmex|eurmex)', re.I)),
    ('OMS', re.compile(r'(cmsy|cmbsy|txsy(?![abc])|txbsy|pxsy(?![abc])|HFBRSY|lmsy)', re.I)),
    ('OML', re.compile(r'(cmmi|rtxmi|rntxmi|rtxbmi|HFBRMI|HFBRMB|lmmi|rpxmi)', re.I)),
    ('OT1', re.compile(r'^(cm(r|bx|ti|sl|ss|tt|csc|u|dunh|fib|ff)\d|HFBR(?!MI|SY|MB)|rtxr|rtxss|rtxb$|rtcxss|SFBMR)', re.I)),
]
TABLES = {'OML': OML, 'OMS': OMS, 'OMX': OMX, 'OT1': OT1}


def family_of(fontname):
    n = (fontname or '').split('+')[-1]
    for fam, pat in FAMILY_PATTERNS:
        if pat.search(n):
            return fam
    return None
