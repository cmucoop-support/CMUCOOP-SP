var $ = function (s) { return document.querySelector(s); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var stripOldNote = function () { return ''; };   /* ตัดหมายเหตุช่วงสำรวจออกจากหัวตาราง/ไฟล์ส่งออก */
var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
var nf0 = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
var nf2 = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
var money = function (n) { return (n === null || n === undefined || n === '' || !isFinite(Number(n))) ? '–' : nf2.format(Number(n)); };
var pctF = function (n) { return (n === null || n === undefined || !isFinite(Number(n))) ? '–' : nf2.format(Number(n) * 100) + '%'; };

var THEME1_XML = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<a:theme xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" name=\"Office Theme\"><a:themeElements><a:clrScheme name=\"Office\"><a:dk1><a:sysClr val=\"windowText\" lastClr=\"000000\"/></a:dk1><a:lt1><a:sysClr val=\"window\" lastClr=\"FFFFFF\"/></a:lt1><a:dk2><a:srgbClr val=\"0E2841\"/></a:dk2><a:lt2><a:srgbClr val=\"E8E8E8\"/></a:lt2><a:accent1><a:srgbClr val=\"156082\"/></a:accent1><a:accent2><a:srgbClr val=\"E97132\"/></a:accent2><a:accent3><a:srgbClr val=\"196B24\"/></a:accent3><a:accent4><a:srgbClr val=\"0F9ED5\"/></a:accent4><a:accent5><a:srgbClr val=\"A02B93\"/></a:accent5><a:accent6><a:srgbClr val=\"4EA72E\"/></a:accent6><a:hlink><a:srgbClr val=\"467886\"/></a:hlink><a:folHlink><a:srgbClr val=\"96607D\"/></a:folHlink></a:clrScheme><a:fontScheme name=\"Office\"><a:majorFont><a:latin typeface=\"Aptos Display\" panose=\"02110004020202020204\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/><a:font script=\"Jpan\" typeface=\"游ゴシック Light\"/><a:font script=\"Hang\" typeface=\"맑은 고딕\"/><a:font script=\"Hans\" typeface=\"等线 Light\"/><a:font script=\"Hant\" typeface=\"新細明體\"/><a:font script=\"Arab\" typeface=\"Times New Roman\"/><a:font script=\"Hebr\" typeface=\"Times New Roman\"/><a:font script=\"Thai\" typeface=\"Tahoma\"/><a:font script=\"Ethi\" typeface=\"Nyala\"/><a:font script=\"Beng\" typeface=\"Vrinda\"/><a:font script=\"Gujr\" typeface=\"Shruti\"/><a:font script=\"Khmr\" typeface=\"MoolBoran\"/><a:font script=\"Knda\" typeface=\"Tunga\"/><a:font script=\"Guru\" typeface=\"Raavi\"/><a:font script=\"Cans\" typeface=\"Euphemia\"/><a:font script=\"Cher\" typeface=\"Plantagenet Cherokee\"/><a:font script=\"Yiii\" typeface=\"Microsoft Yi Baiti\"/><a:font script=\"Tibt\" typeface=\"Microsoft Himalaya\"/><a:font script=\"Thaa\" typeface=\"MV Boli\"/><a:font script=\"Deva\" typeface=\"Mangal\"/><a:font script=\"Telu\" typeface=\"Gautami\"/><a:font script=\"Taml\" typeface=\"Latha\"/><a:font script=\"Syrc\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Orya\" typeface=\"Kalinga\"/><a:font script=\"Mlym\" typeface=\"Kartika\"/><a:font script=\"Laoo\" typeface=\"DokChampa\"/><a:font script=\"Sinh\" typeface=\"Iskoola Pota\"/><a:font script=\"Mong\" typeface=\"Mongolian Baiti\"/><a:font script=\"Viet\" typeface=\"Times New Roman\"/><a:font script=\"Uigh\" typeface=\"Microsoft Uighur\"/><a:font script=\"Geor\" typeface=\"Sylfaen\"/><a:font script=\"Armn\" typeface=\"Arial\"/><a:font script=\"Bugi\" typeface=\"Leelawadee UI\"/><a:font script=\"Bopo\" typeface=\"Microsoft JhengHei\"/><a:font script=\"Java\" typeface=\"Javanese Text\"/><a:font script=\"Lisu\" typeface=\"Segoe UI\"/><a:font script=\"Mymr\" typeface=\"Myanmar Text\"/><a:font script=\"Nkoo\" typeface=\"Ebrima\"/><a:font script=\"Olck\" typeface=\"Nirmala UI\"/><a:font script=\"Osma\" typeface=\"Ebrima\"/><a:font script=\"Phag\" typeface=\"Phagspa\"/><a:font script=\"Syrn\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Syrj\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Syre\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Sora\" typeface=\"Nirmala UI\"/><a:font script=\"Tale\" typeface=\"Microsoft Tai Le\"/><a:font script=\"Talu\" typeface=\"Microsoft New Tai Lue\"/><a:font script=\"Tfng\" typeface=\"Ebrima\"/></a:majorFont><a:minorFont><a:latin typeface=\"Aptos Narrow\" panose=\"02110004020202020204\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/><a:font script=\"Jpan\" typeface=\"游ゴシック\"/><a:font script=\"Hang\" typeface=\"맑은 고딕\"/><a:font script=\"Hans\" typeface=\"等线\"/><a:font script=\"Hant\" typeface=\"新細明體\"/><a:font script=\"Arab\" typeface=\"Arial\"/><a:font script=\"Hebr\" typeface=\"Arial\"/><a:font script=\"Thai\" typeface=\"Tahoma\"/><a:font script=\"Ethi\" typeface=\"Nyala\"/><a:font script=\"Beng\" typeface=\"Vrinda\"/><a:font script=\"Gujr\" typeface=\"Shruti\"/><a:font script=\"Khmr\" typeface=\"DaunPenh\"/><a:font script=\"Knda\" typeface=\"Tunga\"/><a:font script=\"Guru\" typeface=\"Raavi\"/><a:font script=\"Cans\" typeface=\"Euphemia\"/><a:font script=\"Cher\" typeface=\"Plantagenet Cherokee\"/><a:font script=\"Yiii\" typeface=\"Microsoft Yi Baiti\"/><a:font script=\"Tibt\" typeface=\"Microsoft Himalaya\"/><a:font script=\"Thaa\" typeface=\"MV Boli\"/><a:font script=\"Deva\" typeface=\"Mangal\"/><a:font script=\"Telu\" typeface=\"Gautami\"/><a:font script=\"Taml\" typeface=\"Latha\"/><a:font script=\"Syrc\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Orya\" typeface=\"Kalinga\"/><a:font script=\"Mlym\" typeface=\"Kartika\"/><a:font script=\"Laoo\" typeface=\"DokChampa\"/><a:font script=\"Sinh\" typeface=\"Iskoola Pota\"/><a:font script=\"Mong\" typeface=\"Mongolian Baiti\"/><a:font script=\"Viet\" typeface=\"Arial\"/><a:font script=\"Uigh\" typeface=\"Microsoft Uighur\"/><a:font script=\"Geor\" typeface=\"Sylfaen\"/><a:font script=\"Armn\" typeface=\"Arial\"/><a:font script=\"Bugi\" typeface=\"Leelawadee UI\"/><a:font script=\"Bopo\" typeface=\"Microsoft JhengHei\"/><a:font script=\"Java\" typeface=\"Javanese Text\"/><a:font script=\"Lisu\" typeface=\"Segoe UI\"/><a:font script=\"Mymr\" typeface=\"Myanmar Text\"/><a:font script=\"Nkoo\" typeface=\"Ebrima\"/><a:font script=\"Olck\" typeface=\"Nirmala UI\"/><a:font script=\"Osma\" typeface=\"Ebrima\"/><a:font script=\"Phag\" typeface=\"Phagspa\"/><a:font script=\"Syrn\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Syrj\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Syre\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Sora\" typeface=\"Nirmala UI\"/><a:font script=\"Tale\" typeface=\"Microsoft Tai Le\"/><a:font script=\"Talu\" typeface=\"Microsoft New Tai Lue\"/><a:font script=\"Tfng\" typeface=\"Ebrima\"/></a:minorFont></a:fontScheme><a:fmtScheme name=\"Office\"><a:fillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:lumMod val=\"110000\"/><a:satMod val=\"105000\"/><a:tint val=\"67000\"/></a:schemeClr></a:gs><a:gs pos=\"50000\"><a:schemeClr val=\"phClr\"><a:lumMod val=\"105000\"/><a:satMod val=\"103000\"/><a:tint val=\"73000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:lumMod val=\"105000\"/><a:satMod val=\"109000\"/><a:tint val=\"81000\"/></a:schemeClr></a:gs></a:gsLst><a:lin ang=\"5400000\" scaled=\"0\"/></a:gradFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:satMod val=\"103000\"/><a:lumMod val=\"102000\"/><a:tint val=\"94000\"/></a:schemeClr></a:gs><a:gs pos=\"50000\"><a:schemeClr val=\"phClr\"><a:satMod val=\"110000\"/><a:lumMod val=\"100000\"/><a:shade val=\"100000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:lumMod val=\"99000\"/><a:satMod val=\"120000\"/><a:shade val=\"78000\"/></a:schemeClr></a:gs></a:gsLst><a:lin ang=\"5400000\" scaled=\"0\"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w=\"12700\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/><a:miter lim=\"800000\"/></a:ln><a:ln w=\"19050\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/><a:miter lim=\"800000\"/></a:ln><a:ln w=\"25400\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/><a:miter lim=\"800000\"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad=\"57150\" dist=\"19050\" dir=\"5400000\" algn=\"ctr\" rotWithShape=\"0\"><a:srgbClr val=\"000000\"><a:alpha val=\"63000\"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"><a:tint val=\"95000\"/><a:satMod val=\"170000\"/></a:schemeClr></a:solidFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:tint val=\"93000\"/><a:satMod val=\"150000\"/><a:shade val=\"98000\"/><a:lumMod val=\"102000\"/></a:schemeClr></a:gs><a:gs pos=\"50000\"><a:schemeClr val=\"phClr\"><a:tint val=\"98000\"/><a:satMod val=\"130000\"/><a:shade val=\"90000\"/><a:lumMod val=\"103000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:shade val=\"63000\"/><a:satMod val=\"120000\"/></a:schemeClr></a:gs></a:gsLst><a:lin ang=\"5400000\" scaled=\"0\"/></a:gradFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults><a:lnDef><a:spPr/><a:bodyPr/><a:lstStyle/><a:style><a:lnRef idx=\"2\"><a:schemeClr val=\"accent1\"/></a:lnRef><a:fillRef idx=\"0\"><a:schemeClr val=\"accent1\"/></a:fillRef><a:effectRef idx=\"1\"><a:schemeClr val=\"accent1\"/></a:effectRef><a:fontRef idx=\"minor\"><a:schemeClr val=\"tx1\"/></a:fontRef></a:style></a:lnDef></a:objectDefaults><a:extraClrSchemeLst/><a:extLst><a:ext uri=\"{05A4C25C-085E-4340-85A3-A5531E510DB2}\"><thm15:themeFamily xmlns:thm15=\"http://schemas.microsoft.com/office/thememl/2012/main\" name=\"Office Theme\" id=\"{2E142A2C-CD16-42D6-873A-C26D2A0506FA}\" vid=\"{1BDDFF52-6CD6-40A5-AB3C-68EB2F1E4D0A}\"/></a:ext></a:extLst></a:theme>";
var STYLES_XML = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" mc:Ignorable=\"x14ac x16r2 xr\" xmlns:x14ac=\"http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac\" xmlns:x16r2=\"http://schemas.microsoft.com/office/spreadsheetml/2015/02/main\" xmlns:xr=\"http://schemas.microsoft.com/office/spreadsheetml/2014/revision\"><numFmts count=\"2\"><numFmt numFmtId=\"44\" formatCode=\"_-&quot;฿&quot;* #,##0.00_-;\\-&quot;฿&quot;* #,##0.00_-;_-&quot;฿&quot;* &quot;-&quot;??_-;_-@_-\"/><numFmt numFmtId=\"164\" formatCode=\"&quot;฿&quot;#,##0.00\"/></numFmts><fonts count=\"7\" x14ac:knownFonts=\"1\"><font><sz val=\"11\"/><color theme=\"1\"/><name val=\"Aptos Narrow\"/><family val=\"2\"/><charset val=\"222\"/><scheme val=\"minor\"/></font><font><sz val=\"12\"/><color theme=\"1\"/><name val=\"TH Sarabun New\"/><family val=\"2\"/></font><font><sz val=\"10\"/><color theme=\"1\"/><name val=\"TH Sarabun New\"/><family val=\"2\"/></font><font><b/><sz val=\"10\"/><color theme=\"1\"/><name val=\"TH Sarabun New\"/><family val=\"2\"/></font><font><b/><sz val=\"12\"/><color theme=\"1\"/><name val=\"TH Sarabun New\"/><family val=\"2\"/></font><font><b/><u/><sz val=\"12\"/><color rgb=\"FFFF0000\"/><name val=\"TH Sarabun New\"/><family val=\"2\"/></font><font><sz val=\"12\"/><color theme=\"0\"/><name val=\"TH Sarabun New\"/><family val=\"2\"/></font></fonts><fills count=\"9\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill><fill><patternFill patternType=\"solid\"><fgColor theme=\"0\" tint=\"-0.14999847407452621\"/><bgColor indexed=\"64\"/></patternFill></fill><fill><patternFill patternType=\"solid\"><fgColor theme=\"0\" tint=\"-0.34998626667073579\"/><bgColor indexed=\"64\"/></patternFill></fill><fill><patternFill patternType=\"solid\"><fgColor theme=\"5\" tint=\"0.39997558519241921\"/><bgColor indexed=\"64\"/></patternFill></fill><fill><patternFill patternType=\"solid\"><fgColor theme=\"3\" tint=\"0.749992370372631\"/><bgColor indexed=\"64\"/></patternFill></fill><fill><patternFill patternType=\"solid\"><fgColor theme=\"5\" tint=\"0.59999389629810485\"/><bgColor indexed=\"64\"/></patternFill></fill><fill><patternFill patternType=\"solid\"><fgColor theme=\"0\"/><bgColor indexed=\"64\"/></patternFill></fill><fill><patternFill patternType=\"solid\"><fgColor theme=\"0\" tint=\"-4.9989318521683403E-2\"/><bgColor indexed=\"64\"/></patternFill></fill></fills><borders count=\"14\"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style=\"thin\"><color indexed=\"64\"/></left><right/><top style=\"thin\"><color indexed=\"64\"/></top><bottom style=\"thin\"><color indexed=\"64\"/></bottom><diagonal/></border><border><left/><right/><top style=\"thin\"><color indexed=\"64\"/></top><bottom style=\"thin\"><color indexed=\"64\"/></bottom><diagonal/></border><border><left/><right style=\"thin\"><color indexed=\"64\"/></right><top style=\"thin\"><color indexed=\"64\"/></top><bottom style=\"thin\"><color indexed=\"64\"/></bottom><diagonal/></border><border><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top style=\"thin\"><color indexed=\"64\"/></top><bottom/><diagonal/></border><border><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top/><bottom/><diagonal/></border><border><left style=\"thin\"><color indexed=\"64\"/></left><right/><top style=\"thin\"><color indexed=\"64\"/></top><bottom/><diagonal/></border><border><left/><right style=\"thin\"><color indexed=\"64\"/></right><top style=\"thin\"><color indexed=\"64\"/></top><bottom/><diagonal/></border><border><left style=\"thin\"><color indexed=\"64\"/></left><right/><top/><bottom style=\"thin\"><color indexed=\"64\"/></bottom><diagonal/></border><border><left/><right style=\"thin\"><color indexed=\"64\"/></right><top/><bottom style=\"thin\"><color indexed=\"64\"/></bottom><diagonal/></border><border><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top/><bottom style=\"thin\"><color indexed=\"64\"/></bottom><diagonal/></border><border><left style=\"thin\"><color indexed=\"64\"/></left><right style=\"thin\"><color indexed=\"64\"/></right><top style=\"thin\"><color indexed=\"64\"/></top><bottom style=\"thin\"><color indexed=\"64\"/></bottom><diagonal/></border><border><left/><right/><top/><bottom style=\"thin\"><color indexed=\"64\"/></bottom><diagonal/></border><border><left/><right/><top style=\"thin\"><color indexed=\"64\"/></top><bottom/><diagonal/></border></borders><cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs><cellXfs count=\"120\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/><xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"2\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"3\" fillId=\"2\" borderId=\"11\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"4\" fillId=\"0\" borderId=\"11\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"1\" fontId=\"1\" fillId=\"0\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"11\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"left\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"11\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"2\" fillId=\"0\" borderId=\"11\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"14\" fontId=\"2\" fillId=\"0\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"44\" fontId=\"1\" fillId=\"3\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"44\" fontId=\"1\" fillId=\"4\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"44\" fontId=\"1\" fillId=\"0\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"10\" fontId=\"1\" fillId=\"0\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"44\" fontId=\"1\" fillId=\"5\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"44\" fontId=\"1\" fillId=\"0\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"44\" fontId=\"1\" fillId=\"2\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" readingOrder=\"2\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"7\" borderId=\"11\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"11\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\"/><xf numFmtId=\"0\" fontId=\"4\" fillId=\"8\" borderId=\"11\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"1\" fontId=\"1\" fillId=\"8\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"8\" borderId=\"11\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"left\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"8\" borderId=\"11\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"2\" fillId=\"8\" borderId=\"11\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"14\" fontId=\"2\" fillId=\"8\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"5\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"1\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"left\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"6\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"2\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"14\" fontId=\"2\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"44\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"10\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"44\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"44\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" readingOrder=\"2\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\"/><xf numFmtId=\"0\" fontId=\"0\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyFill=\"1\"/><xf numFmtId=\"0\" fontId=\"0\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"7\" borderId=\"11\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"left\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"10\" fontId=\"1\" fillId=\"7\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"10\" fontId=\"1\" fillId=\"7\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"4\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"top\" wrapText=\"1\"/></xf><xf numFmtId=\"44\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" readingOrder=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"left\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\"/></xf><xf numFmtId=\"44\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" readingOrder=\"1\"/></xf><xf numFmtId=\"44\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"0\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyFill=\"1\" applyAlignment=\"1\"><alignment wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"0\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"left\"/></xf><xf numFmtId=\"44\" fontId=\"0\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment readingOrder=\"1\"/></xf><xf numFmtId=\"10\" fontId=\"0\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFill=\"1\"/><xf numFmtId=\"44\" fontId=\"0\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFill=\"1\"/><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyAlignment=\"1\"><alignment horizontal=\"center\"/></xf><xf numFmtId=\"44\" fontId=\"1\" fillId=\"6\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" readingOrder=\"2\"/></xf><xf numFmtId=\"164\" fontId=\"3\" fillId=\"2\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"164\" fontId=\"1\" fillId=\"6\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"44\" fontId=\"1\" fillId=\"6\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"right\" vertical=\"center\" readingOrder=\"2\"/></xf><xf numFmtId=\"164\" fontId=\"1\" fillId=\"6\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"right\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"44\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"right\" vertical=\"center\" readingOrder=\"2\"/></xf><xf numFmtId=\"164\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"right\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"0\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"right\"/></xf><xf numFmtId=\"164\" fontId=\"0\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"right\"/></xf><xf numFmtId=\"44\" fontId=\"0\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"right\" readingOrder=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyAlignment=\"1\"><alignment horizontal=\"right\"/></xf><xf numFmtId=\"164\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyAlignment=\"1\"><alignment horizontal=\"right\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"left\" vertical=\"top\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"14\" fontId=\"2\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"14\" fontId=\"3\" fillId=\"2\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"14\" fontId=\"0\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFill=\"1\"/><xf numFmtId=\"14\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/><xf numFmtId=\"0\" fontId=\"3\" fillId=\"2\" borderId=\"11\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"14\" fontId=\"3\" fillId=\"2\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyAlignment=\"1\"><alignment horizontal=\"left\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyAlignment=\"1\"><alignment horizontal=\"right\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"3\" fillId=\"2\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"3\" fillId=\"2\" borderId=\"2\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"14\" fontId=\"3\" fillId=\"2\" borderId=\"2\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"3\" fillId=\"2\" borderId=\"2\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"right\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"3\" fillId=\"2\" borderId=\"3\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"3\" fillId=\"2\" borderId=\"4\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"3\" fillId=\"2\" borderId=\"5\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"3\" fillId=\"2\" borderId=\"10\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"1\" fontId=\"3\" fillId=\"2\" borderId=\"4\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"1\" fontId=\"3\" fillId=\"2\" borderId=\"5\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"1\" fontId=\"3\" fillId=\"2\" borderId=\"10\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"3\" fillId=\"2\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"3\" fillId=\"2\" borderId=\"2\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\"/></xf><xf numFmtId=\"14\" fontId=\"3\" fillId=\"2\" borderId=\"2\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"3\" fillId=\"2\" borderId=\"3\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\"/></xf><xf numFmtId=\"44\" fontId=\"3\" fillId=\"2\" borderId=\"4\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"44\" fontId=\"3\" fillId=\"2\" borderId=\"5\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"44\" fontId=\"3\" fillId=\"2\" borderId=\"10\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"3\" fillId=\"2\" borderId=\"6\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"3\" fillId=\"2\" borderId=\"7\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"3\" fillId=\"2\" borderId=\"8\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"3\" fillId=\"2\" borderId=\"9\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"44\" fontId=\"3\" fillId=\"2\" borderId=\"4\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\" readingOrder=\"2\"/></xf><xf numFmtId=\"44\" fontId=\"3\" fillId=\"2\" borderId=\"5\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\" readingOrder=\"2\"/></xf><xf numFmtId=\"44\" fontId=\"3\" fillId=\"2\" borderId=\"10\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\" readingOrder=\"2\"/></xf><xf numFmtId=\"44\" fontId=\"3\" fillId=\"2\" borderId=\"4\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"44\" fontId=\"3\" fillId=\"2\" borderId=\"5\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"44\" fontId=\"3\" fillId=\"2\" borderId=\"10\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"7\" borderId=\"13\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\"/></xf><xf numFmtId=\"14\" fontId=\"1\" fillId=\"7\" borderId=\"13\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"7\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\"><alignment horizontal=\"right\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"7\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"7\" borderId=\"3\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"14\" fontId=\"4\" fillId=\"7\" borderId=\"1\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"left\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"14\" fontId=\"4\" fillId=\"7\" borderId=\"2\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"left\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"14\" fontId=\"4\" fillId=\"7\" borderId=\"3\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"left\" vertical=\"center\" wrapText=\"1\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"7\" borderId=\"12\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"left\"/></xf><xf numFmtId=\"14\" fontId=\"1\" fillId=\"7\" borderId=\"12\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"left\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"7\" borderId=\"12\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"left\" vertical=\"center\"/></xf><xf numFmtId=\"0\" fontId=\"1\" fillId=\"7\" borderId=\"12\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"right\"/></xf><xf numFmtId=\"14\" fontId=\"1\" fillId=\"7\" borderId=\"11\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"><alignment horizontal=\"left\" vertical=\"top\" wrapText=\"1\"/></xf></cellXfs><cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles><dxfs count=\"8\"><dxf><fill><patternFill><bgColor theme=\"0\" tint=\"-0.24994659260841701\"/></patternFill></fill></dxf><dxf><fill><patternFill><bgColor theme=\"6\" tint=\"0.59996337778862885\"/></patternFill></fill></dxf><dxf><fill><patternFill><bgColor rgb=\"FFFF7C80\"/></patternFill></fill></dxf><dxf><fill><patternFill><bgColor rgb=\"FFFFFF66\"/></patternFill></fill></dxf><dxf><fill><patternFill><bgColor theme=\"3\" tint=\"0.89996032593768116\"/></patternFill></fill></dxf><dxf><fill><patternFill><bgColor theme=\"0\" tint=\"-0.24994659260841701\"/></patternFill></fill></dxf><dxf><fill><patternFill><bgColor theme=\"0\" tint=\"-0.24994659260841701\"/></patternFill></fill></dxf><dxf><fill><patternFill><bgColor theme=\"0\" tint=\"-0.24994659260841701\"/></patternFill></fill></dxf></dxfs><tableStyles count=\"0\" defaultTableStyle=\"TableStyleMedium2\" defaultPivotStyle=\"PivotStyleLight16\"/><extLst><ext uri=\"{EB79DEF2-80B8-43e5-95BD-54CBDDF9020C}\" xmlns:x14=\"http://schemas.microsoft.com/office/spreadsheetml/2009/9/main\"><x14:slicerStyles defaultSlicerStyle=\"SlicerStyleLight1\"/></ext><ext uri=\"{9260A510-F301-46a8-8635-F512D64BE5F5}\" xmlns:x15=\"http://schemas.microsoft.com/office/spreadsheetml/2010/11/main\"><x15:timelineStyles defaultTimelineStyle=\"TimeSlicerStyleLight1\"/></ext></extLst></styleSheet>";

/* ---------- เซสชัน & การเรียกหลังบ้าน ---------- */
var TOKEN = '';
function initToken() {
  var m = (location.hash || '').match(/[#&]t=([^&]+)/);
  if (m) {
    try { TOKEN = decodeURIComponent(m[1]); sessionStorage.setItem('pm_tok', TOKEN); } catch (e) {}
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  } else {
    try { TOKEN = sessionStorage.getItem('pm_tok') || ''; } catch (e) {}
  }
}
function call(fn) {
  var args = Array.prototype.slice.call(arguments, 1);
  if (fn !== 'login' && fn !== 'recoverAdmin' && fn !== 'loginByLink') args.unshift(TOKEN);
  return new Promise(function (res, rej) {
    var r = google.script.run.withSuccessHandler(res).withFailureHandler(function (e) {
      var m = (e && e.message) || String(e);
      if (/SESSION_EXPIRED/.test(m)) { showLogin('หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบอีกครั้ง'); m = 'SESSION_EXPIRED'; }
      rej(new Error(m));
    });
    r[fn].apply(r, args);
  });
}
var toastT = null;
function toast(msg, isErr) {
  var t = $('#toast'); if (t) t.remove();
  t = document.createElement('div'); t.id = 'toast'; t.className = 'toast' + (isErr ? ' err2' : '');
  t.setAttribute('role', isErr ? 'alert' : 'status');
  t.setAttribute('aria-live', isErr ? 'assertive' : 'polite');
  t.setAttribute('aria-atomic', 'true');
  t.textContent = msg; document.body.appendChild(t);
  clearTimeout(toastT); toastT = setTimeout(function () { t.remove(); }, isErr ? 10000 : 6000);
}
async function busy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { if (e.message !== 'SESSION_EXPIRED') toast(e.message, true); }
  btn.disabled = false;
}
function showLogin(msg) {
  TOKEN = ''; try { sessionStorage.removeItem('pm_tok'); sessionStorage.removeItem('pm_me'); } catch (e) {}
  $('#login').classList.remove('hidden');
  $('#lgMsg').textContent = msg || 'เข้าสู่ระบบด้วยบัญชีเดียวกับระบบหลัก';
  $('#lgErr').textContent = ''; $('#lgPass').value = '';
  setTimeout(function () { $('#lgUser').focus(); }, 50);
}
$('#lgBtn').addEventListener('click', function () {
  var u = $('#lgUser').value.trim(), p = $('#lgPass').value;
  if (!u || !p) { $('#lgErr').textContent = 'กรุณากรอกรหัสผู้ใช้และรหัสผ่าน'; return; }
  var b = this; b.disabled = true; $('#lgErr').textContent = '';
  call('login', u, p).then(function (r) {
    TOKEN = r.token; try { sessionStorage.setItem('pm_tok', TOKEN); sessionStorage.setItem('pm_me', JSON.stringify(r)); } catch (e) {}
    $('#login').classList.add('hidden'); load();
  }, function (e) { $('#lgErr').textContent = e.message; $('#lgPass').value = ''; }).then(function () { b.disabled = false; });
});
['#lgUser', '#lgPass'].forEach(function (s) { $(s).addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#lgBtn').click(); }); });

/* ---------- สถานะของหน้าเว็บ ---------- */
var STORAGE_KEY = 'cmucoop_market_state_v1';
var DEFAULT_BR = 'สาขาหลัก';
var BR_KEY = 'cmucoop_market_br';
var D = {
  me: null,
  store: Object.create(null),       // { 'ชื่อสาขา': { groups:{...}, names:{...} } }
  br: '',          // สาขาที่เลือกอยู่ (D.groups / D.names ชี้ไปที่ข้อมูลของสาขานี้)
  ver: 'cur',
  groups: Object.create(null),      // { '34': { cur: { ts, who, file, rep, surveyNote, rows:[...] }, prev: {...} } }
  names: Object.create(null),
  surveyor: '',
  checker: '',
  approver: '',
  surveyNote: '',
  items: [],
  allGroups: []
};
// The server revision prevents one browser from silently overwriting another's edits.
D.revision = '';
var F = { g: '', move: '', rec: '', q: '', page: 0 };
var PAGE = 100;
var DIRTY = false;

var REC_OPTS = ['คงที่', 'ปรับขึ้น', 'ปรับลง', 'ฝากพิจารณา', 'สินค้าไม่เคลื่อนไหว'];
var REC_META = [
  { k: '', t: 'ทั้งหมด', c: '#7a4be0', s: '●' },
  { k: 'ปรับขึ้น', t: 'ปรับขึ้น', c: '#b42318', s: '▲' },
  { k: 'ปรับลง', t: 'ปรับลง', c: '#5b2fc7', s: '▼' },
  { k: 'ฝากพิจารณา', t: 'ฝากพิจารณา', c: '#176b3f', s: '◆' },
  { k: 'คงที่', t: 'คงที่', c: '#946200', s: '■' },
  { k: 'สินค้าไม่เคลื่อนไหว', t: 'สินค้าไม่เคลื่อนไหว', c: '#5a6573', s: '○' }
];

function brKey(s) { return String(s == null ? '' : s).replace(/[\s\u00a0]+/g, '').toLowerCase(); }
function codeKey(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }
function marketNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  var s = String(v == null ? '' : v).trim().replace(/,/g, '');
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s) && Number.isFinite(Number(s)) ? Number(s) : null;
}
function marketCell(v) {
  if (v === null || v === undefined || String(v).trim() === '') return '';
  var n = marketNumber(v);
  return n === null ? String(v).trim() : n;
}
function thaiDayIso(ts) {
  var date = new Date(ts == null ? Date.now() : ts);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    var obj = {};
    parts.forEach(function (part) { obj[part.type] = part.value; });
    return obj.year + '-' + obj.month + '-' + obj.day;
  } catch (e) {
    return new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  }
}
function todayIso() { return thaiDayIso(); }
function fmtDateSlash(isoOrTs, useBe) {
  if (!isoOrTs) return '';
  var y, m, d;
  if (typeof isoOrTs === 'number') {
    var dt = new Date(isoOrTs + 7 * 3600000);
    y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
  } else {
    var mt = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoOrTs));
    if (!mt) return String(isoOrTs);
    y = +mt[1]; m = +mt[2]; d = +mt[3];
  }
  if (useBe && y < 2400) y += 543;
  if (!useBe && y > 2400) y -= 543;
  return pad2(d) + '/' + pad2(m) + '/' + y;
}
function fmtTsTh(ts) {
  if (!ts) return '–';
  return new Date(ts).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', calendar: 'buddhist' });
}
function grpLabel(g) {
  var n = D.names && D.names[g];
  return n ? g + ' · ' + n : g;
}

/* ---------- คำนวณค่าของแต่ละแถวตามสูตรในไฟล์ 34ผลิตภัณฑ์ดูแลผ้า.xlsx ----------
 * r = [0:g, 1:code, 2:name, 3:qty, 4:chgTxt, 5:chgDate, 6:cost, 7:price, 8:mktMin, 9:mktMax, 10:recAct, 11:recPrice, 12:editNote, 13:repDate] */
function calcItem(r, idx) {
  var qty = marketNumber(r[3]) || 0;
  var cost = marketNumber(r[6]) || 0;
  var price = marketNumber(r[7]) || 0;
  var profitEx = Math.round((price - cost) * 100) / 100;
  var marginEx = cost > 0 ? Math.round(((price - cost) / cost) * 10000) / 10000 : 0;
  var costVat = Math.round(cost * 1.07 * 100) / 100;
  var profitInc = Math.round((price - costVat) * 100) / 100;
  var marginInc = costVat > 0 ? Math.round(((price - costVat) / costVat) * 10000) / 10000 : 0;
  var price30 = Math.round(cost * 1.07 * 1.3 * 100) / 100;
  var recAct = String(r[10] || '').trim() || (qty <= 0 ? 'สินค้าไม่เคลื่อนไหว' : 'คงที่');
  return {
    raw: r,
    i: idx,
    g: String(r[0] || ''),
    code: String(r[1] || ''),
    name: String(r[2] || ''),
    qty: qty,
    chgTxt: String(r[4] == null || r[4] === '' ? '-' : r[4]),
    chgDate: String(r[5] == null || r[5] === '' ? '-' : r[5]),
    cost: cost,
    price: price,
    profitEx: profitEx,
    marginEx: marginEx,
    costVat: costVat,
    profitInc: profitInc,
    marginInc: marginInc,
    price30: price30,
    mktMin: marketCell(r[8]),
    mktMax: marketCell(r[9]),
    recAct: recAct,
    recPrice: marketCell(r[11]),
    editNote: String(r[12] || ''),
    rep: String(r[13] || ''),
    hay: [r[1], r[2], r[4], r[10], r[12]].join(' ').toLowerCase()
  };
}

function dateFromFileName(n) {
  var m = /(?:^|[^\d])(\d{2})(\d{2})(\d{2})(?:[^\d]|$)/.exec(String(n || '')); if (!m) return '';
  var y = 2500 + Number(m[1]) - 543, mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return '';
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
function latestUpdate(x) {          /* ปรับครั้งล่าสุด: ข้อความการปรับ + วันที่ปรับ · ไม่มีข้อมูล หรือราคาในข้อความไม่ตรงราคาขายปัจจุบัน → เว้นว่าง */
  var t = x.chgTxt == null ? '' : String(x.chgTxt).replace(/\u00a0/g, ' ').trim();
  if (!t || t === '-') return { text: '', date: '' };
  var np = chgNewPrice(t);
  if (np !== null && isFinite(np) && Math.abs(np - (Number(x.price) || 0)) >= 0.005) return { text: '', date: '' };
  var d = x.chgDate && x.chgDate !== '-' ? fmtDateSlash(x.chgDate, false) : '';
  return { text: t, date: d };
}

/* กำไรคิดเทียบต้นทุนตามสูตรเดิม; ใช้ราคาแนะนำเฉพาะรายการที่ระบุให้ปรับ/พิจารณา */
function priceProjection(x) {
  var actionable = ['ปรับขึ้น', 'ปรับลง', 'ฝากพิจารณา'].indexOf(x.recAct) >= 0;
  var proposed = marketNumber(x.recPrice);
  var valid = proposed !== null && proposed > 0;
  var hasChange = actionable && valid && Math.abs(proposed - x.price) >= 0.005;
  var price = hasChange ? proposed : x.price;
  return {
    hasChange: hasChange, needsPrice: actionable && !valid, price: price,
    profitEx: Math.round((price - x.cost) * 100) / 100,
    marginEx: x.cost > 0 ? Math.round((price - x.cost) / x.cost * 10000) / 10000 : null,
    profitInc: Math.round((price - x.costVat) * 100) / 100,
    marginInc: x.costVat > 0 ? Math.round((price - x.costVat) / x.costVat * 10000) / 10000 : null
  };
}

function summarizePriceProjection(items) {
  var result = { changedCount: 0, changedActiveCount: 0, missingPriceCount: 0, excludedCostCount: 0, activeCount: 0, eligibleCount: 0,
    avgBeforeEx: null, avgBeforeInc: null, avgAfterEx: null, avgAfterInc: null };
  var beforeEx = 0, beforeInc = 0, afterEx = 0, afterInc = 0;
  (items || []).forEach(function (x) {
    var projected = priceProjection(x);
    if (projected.hasChange) result.changedCount++;
    if (projected.needsPrice) result.missingPriceCount++;
    if (x.qty <= 0) return;
    result.activeCount++;
    if (projected.hasChange) result.changedActiveCount++;
    if (x.cost <= 0 || x.costVat <= 0) { result.excludedCostCount++; return; }
    result.eligibleCount++;
    beforeEx += x.marginEx; beforeInc += x.marginInc;
    afterEx += projected.marginEx; afterInc += projected.marginInc;
  });
  if (result.eligibleCount) {
    result.avgBeforeEx = beforeEx / result.eligibleCount; result.avgBeforeInc = beforeInc / result.eligibleCount;
    result.avgAfterEx = afterEx / result.eligibleCount; result.avgAfterInc = afterInc / result.eligibleCount;
  }
  return result;
}

function projectionPercent(value) { return value === null || value === undefined ? 'คำนวณไม่ได้' : pctF(value); }

function projectionNote(x) {
  var p = priceProjection(x);
  if (p.needsPrice) return '<small class="muted" style="display:block">กรอกราคาแนะนำเพื่อคำนวณกำไรหลังปรับ</small>';
  if (!p.hasChange) return '';
  return '<small style="display:block">กำไรหลังปรับ (รวม Vat): ' + projectionPercent(p.marginInc) + '</small>';
}

/* ---------- ตรวจสอบ "การปรับ" ให้ตรงกับคอลัมน์ราคาขาย ----------
 * ข้อความการปรับ เช่น "> ปรับขึ้น\nเดิม 129 ขึ้น 135" → ราคาใหม่ในข้อความ (135) ต้องเท่ากับราคาขายปัจจุบัน
 * ถ้าไม่ตรง → ลบทั้ง "การปรับ" และ "วันที่" (ตั้งเป็น "-") */
function chgNewPrice(t) {
  var m = /(?:ข[ึ้]{2}น|ลง)\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*$/.exec(String(t == null ? '' : t).trim());
  return m ? Number(m[1].replace(/,/g, '')) : null;
}
function sanitizeChg(r) {
  var t = r[4];
  if (t === null || t === undefined || t === '' || t === '-') return false;
  var np = chgNewPrice(t);
  if (np === null || !isFinite(np)) return false;      // อ่านราคาไม่ออก (ข้อความอิสระ) → ไม่แตะ
  var price = Number(r[7]); if (!isFinite(price)) price = 0;
  if (Math.abs(np - price) < 0.005) return false;
  r[4] = '-'; r[5] = '-';
  return true;
}
function fixChgAll() {
  var n = 0;
  Object.keys(D.store).forEach(function (b) {
    var gs = D.store[b].groups;
    Object.keys(gs).forEach(function (g) {
      ['cur', 'prev'].forEach(function (v) {
        var side = gs[g] && gs[g][v];
        if (side && Array.isArray(side.rows)) side.rows.forEach(function (r) { if (sanitizeChg(r)) n++; });
      });
    });
  });
  return n;
}

/* ---------- สาขา ---------- */
function stateObj() {
  return { branches: D.store, surveyor: D.surveyor, checker: D.checker, approver: D.approver, surveyNote: D.surveyNote, revision: D.revision };
}
function applyState(o) {
  if (!o || typeof o !== 'object') return false;
  var st = null;
  if (o.branches && typeof o.branches === 'object') {
    st = Object.create(null);
    Object.keys(o.branches).forEach(function (b) {
      var v = o.branches[b] || {};
      st[b] = { groups: Object.assign(Object.create(null), v.groups && typeof v.groups === 'object' ? v.groups : {}), names: Object.assign(Object.create(null), v.names && typeof v.names === 'object' ? v.names : {}) };
    });
  } else if (o.groups && typeof o.groups === 'object') {   // ข้อมูลเก่าก่อนมีสาขา → ย้ายเข้า "สาขาหลัก"
    st = Object.create(null);
    var nm = Object.assign(Object.create(null), o.names && typeof o.names === 'object' ? o.names : {});
    if (Object.keys(o.groups).length || Object.keys(nm).length) st[DEFAULT_BR] = { groups: Object.assign(Object.create(null), o.groups), names: nm };
  }
  if (!st) return false;
  D.store = st;
  if (o.surveyor !== undefined) D.surveyor = String(o.surveyor || '');
  if (o.checker !== undefined) D.checker = o.checker;
  if (o.approver !== undefined) D.approver = o.approver;
  if (o.surveyNote !== undefined) D.surveyNote = o.surveyNote;
  D.revision = typeof o.revision === 'string' ? o.revision : '';
  return true;
}
function ensureBranch(name) {
  if (!D.store[name]) D.store[name] = { groups: Object.create(null), names: Object.create(null) };
  return D.store[name];
}
function findBranch(name) {
  var k = brKey(name), hit = '';
  Object.keys(D.store).forEach(function (b) { if (brKey(b) === k) hit = b; });
  return hit;
}
function setBranch(b) {
  if (!b || !D.store[b]) {
    var keys = Object.keys(D.store).sort();
    b = (D.br && D.store[D.br]) ? D.br : (keys[0] || '');
  }
  D.br = b;
  D.groups = b ? D.store[b].groups : Object.create(null);
  D.names = b ? D.store[b].names : Object.create(null);
  try { localStorage.setItem(BR_KEY, b); } catch (e) {}
}

/* ---------- บันทึก/โหลดสถานะ (รองรับทั้ง Cloud Worker API + LocalStorage Fallback) ---------- */
// Coalesce edits before serializing a large draft; flush before a request or
// page exit so an uncertain network result can still be recovered locally.
var LOCAL_SAVE_TIMER = null, LOCAL_SAVE_USER = '';
function flushLocalState() {
  if (LOCAL_SAVE_TIMER !== null) clearTimeout(LOCAL_SAVE_TIMER);
  LOCAL_SAVE_TIMER = null;
  var user = LOCAL_SAVE_USER; LOCAL_SAVE_USER = '';
  if (!user || !D.me || D.me.user !== user) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: user, pending: DIRTY, state: stateObj() })); } catch (e) {}
}
function saveLocalState() {
  if (!D.me || !D.me.user) return;
  LOCAL_SAVE_USER = D.me.user;
  if (LOCAL_SAVE_TIMER === null) LOCAL_SAVE_TIMER = setTimeout(flushLocalState, 250);
}
function loadLocalState() {
  try {
    var cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    // Never show a previous account's cached branch data when the network is unavailable.
    if (cached && D.me && cached.user === D.me.user && applyState(cached.state)) {
      DIRTY = !!cached.pending && !!D.me.edit;
      return true;
    }
  } catch (e) {}
  return false;
}

/* บันทึกขึ้นเซิร์ฟเวอร์ · คืนค่า true = สำเร็จ · false = ไม่สำเร็จ (แสดงข้อความแจ้งเตือน ยกเว้น quiet) */
var SAVE_CHAIN = Promise.resolve();
function stateContent(state) {
  var copy = Object.assign({}, state); delete copy.revision;
  return JSON.stringify(copy);
}
function syncToServer(quiet) {
  if (!D.me || !D.me.edit) return Promise.resolve(false);
  var saveUser = D.me.user, saveToken = TOKEN;
  DIRTY = true;
  $('#bSaveEdits').classList.remove('hidden');
  saveLocalState();
  SAVE_CHAIN = SAVE_CHAIN.then(async function () {
    try {
      if (!D.me || D.me.user !== saveUser || TOKEN !== saveToken) return false;
      if (!DIRTY) return true;
      flushLocalState();
      // Capture at execution time: queued clicks share the newest draft and do
      // not retain multiple complete copies of a large market dataset.
      var content = stateContent(stateObj());
      var snapshot = JSON.parse(content);
      snapshot.revision = D.revision;
      var saved = await call('marketSaveState', snapshot);
      if (!D.me || D.me.user !== saveUser || TOKEN !== saveToken) return false;
      if (saved && typeof saved.revision === 'string') D.revision = saved.revision;
      if (content === stateContent(stateObj())) DIRTY = false;
      $('#bSaveEdits').classList.toggle('hidden', !DIRTY);
      saveLocalState();
      return true;
    } catch (e) {
      if (e.message !== 'SESSION_EXPIRED' && !quiet) toast('บันทึกขึ้นเซิร์ฟเวอร์ไม่สำเร็จ: ' + e.message + ' — การแก้ไขยังอยู่ในหน้านี้ กรุณาบันทึกอีกครั้ง', true);
      syncToServer.lastErr = e.message;
      return false;
    }
  });
  return SAVE_CHAIN;
}
function syncThen(okMsg) {
  return syncToServer(true).then(function (ok) {
    if (ok) toast(okMsg);
    else if (syncToServer.lastErr !== 'SESSION_EXPIRED') toast('ยังบันทึกขึ้นเซิร์ฟเวอร์ไม่สำเร็จ (' + syncToServer.lastErr + ') — การแก้ไขยังอยู่ในหน้านี้ กรุณาบันทึกอีกครั้ง', true);
    return ok;
  });
}

function rebuildItems() {
  D.allGroups = Object.keys(D.groups).filter(function (g) {
    return D.groups[g] && (D.ver === 'prev' ? D.groups[g].prev : D.groups[g].cur);
  }).sort();
  if (F.g && D.allGroups.indexOf(F.g) < 0) {
    F.g = '';
  }
  var allRows = [];
  D.allGroups.forEach(function (g) {
    var side = D.ver === 'prev' ? D.groups[g].prev : D.groups[g].cur;
    if (side && Array.isArray(side.rows)) {
      side.rows.forEach(function (r) { allRows.push(r); });
    }
  });
  D.items = allRows.map(calcItem);
}

async function load() {
  flushLocalState();
  if (!TOKEN) { showLogin(''); return false; }
  var prefBr = ''; try { prefBr = localStorage.getItem(BR_KEY) || ''; } catch (e0) {}
  try {
    var me = await call('whoami');
    try { sessionStorage.setItem('pm_me', JSON.stringify(me)); } catch (e) {}
    var canView = me.role === 'admin' || (me.perms && me.perms.market);
    if (!canView) {
      showLogin('บัญชีนี้ยังไม่ได้รับสิทธิ์การ์ดเช็คราคาตลาด — ติดต่อ Admin หรือเข้าสู่ระบบด้วยบัญชีอื่น');
      return false;
    }
    var canEdit = me.role === 'admin' || !!(me.perms && me.perms.market && me.perms.market_edit);
    D.me = { user: me.user, name: me.name, role: me.role, edit: canEdit };
    D.store = Object.create(null); D.groups = Object.create(null); D.names = Object.create(null); D.revision = ''; DIRTY = false;
    D.surveyor = ''; D.checker = ''; D.approver = ''; D.surveyNote = '';
    var hasCache = loadLocalState(), fromServer = false;
    try {
      var srv = await call('marketGet');
      if (hasCache && DIRTY) {
        toast('มีการแก้ไขที่ยังไม่ได้บันทึกในเครื่องนี้ กรุณากดบันทึกการแก้ไข หรือรีเฟรชเพื่อละทิ้งการแก้ไข', true);
      } else {
        if (!applyState(srv)) throw new Error('รูปแบบข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง');
        fromServer = true;
        DIRTY = false;
        saveLocalState();
      }
    } catch (e2) {
      if (e2.message === 'SESSION_EXPIRED') return false;
      toast('ดึงข้อมูลล่าสุดจากเซิร์ฟเวอร์ไม่สำเร็จ: ' + e2.message + (hasCache ? ' (กำลังแสดงข้อมูลที่บันทึกไว้ในเครื่อง)' : ' (ยังไม่มีข้อมูลสำรองของบัญชีนี้)'), true);
    }
    setBranch(prefBr);
    rebuildItems();
    renderAll();
    return fromServer;
  } catch (e) {
    if (e.message !== 'SESSION_EXPIRED') showLogin(e.message);
    return false;
  }
}

/* ---------- ฟังก์ชันตรวจสอบรอบ 15 วัน ---------- */
function cycleStatus(ts) {
  if (!ts) return { days: 0, left: 15, cls: 'warn', txt: 'ยังไม่มีประวัติวันที่อัปโหลด' };
  var days = Math.max(0, Math.floor((Date.now() - ts) / 86400000));
  var left = 15 - days;
  if (days >= 15) {
    return { days: days, left: left, cls: 'bad', txt: 'อัปโหลดมาแล้ว ' + days + ' วัน (ครบรอบ/เกินกำหนด 15 วัน — ควรอัปข้อมูลใหม่เข้าระบบ)' };
  }
  if (days >= 11) {
    return { days: days, left: left, cls: 'warn', txt: 'อัปโหลดเมื่อ ' + days + ' วันที่แล้ว · เหลืออีก ' + left + ' วันครบรอบอัปข้อมูล 15 วัน' };
  }
  return { days: days, left: left, cls: 'ok', txt: 'อัปโหลดเมื่อ ' + (days === 0 ? 'วันนี้' : days + ' วันที่แล้ว') + ' · เหลืออีก ' + left + ' วันครบรอบอัปข้อมูล 15 วัน' };
}

function curGroupMeta(g) {
  var key = g || F.g;
  if (key) {
    var grp = D.groups[key];
    return grp ? (D.ver === 'prev' ? grp.prev : grp.cur) : null;
  }
  return D.allGroups.reduce(function (latest, group) {
    var side = D.ver === 'prev' ? D.groups[group].prev : D.groups[group].cur;
    return side && (!latest || Number(side.ts) > Number(latest.ts)) ? side : latest;
  }, null);
}

function filteredItems() {
  var q = (F.q || '').trim().toLowerCase();
  return D.items.filter(function (x) {
    if (F.g && x.g !== F.g) return false;
    if (F.move === 'active' && !(x.qty > 0)) return false;
    if (F.move === 'inactive' && x.qty > 0) return false;
    if (F.move === 'changed' && !latestUpdate(x).text) return false;
    if (F.rec && x.recAct !== F.rec) {
      return false;
    }
    if (q && x.hay.indexOf(q) < 0) return false;
    return true;
  });
}

/* ---------- วาดหน้าจอทั้งหมด ---------- */
function renderAll() {
  var edit = !!(D.me && D.me.edit);
  $('#bUpload').classList.toggle('hidden', !edit);
  $('#bNames').classList.toggle('hidden', !edit);
  $('#bAutoRec').classList.toggle('hidden', !edit);
  $('#bDelGrp').classList.toggle('hidden', !edit || !F.g || D.ver !== 'cur');
  $('#bSaveEdits').classList.toggle('hidden', !edit || !DIRTY);
  $('#bAutoRec').disabled = D.ver !== 'cur';
  $('#bXlsx').disabled = !D.items.length;
  $('#bEmptyUpload').classList.toggle('hidden', !edit);
  ['#sigSurveyor', '#sigChecker', '#sigApprover'].forEach(function (sel) { $(sel).readOnly = !edit || D.ver !== 'cur'; });

  var brKeys = Object.keys(D.store).sort();
  $('#brSel').innerHTML = brKeys.length ? brKeys.map(function (b) {
    var n = Object.keys(D.store[b].groups).length;
    return '<option value="' + esc(b) + '"' + (D.br === b ? ' selected' : '') + '>สาขา ' + esc(b) + ' (' + n + ' หมวด)</option>';
  }).join('') : '<option value="">ยังไม่มีสาขา</option>';
  $('#brSel').disabled = !brKeys.length;

  var hasData = Object.keys(D.groups).length > 0;
  $('#empty').classList.toggle('hidden', hasData);
  $('#main').hidden = !hasData;
  if (!hasData) {
    $('#info').textContent = D.me ? 'ผู้ใช้: ' + D.me.name : '';
    $('#emptyMsg').textContent = edit ? (D.br ? 'สาขา ' + D.br + ' ยังไม่มีข้อมูล · ' : '') + 'กดปุ่มด้านล่างเพื่ออัปโหลดไฟล์ Excel สำรวจราคาตลาดไฟล์ใหม่ (เลือกสาขาในหน้าต่างอัปโหลด)' : (D.br ? 'สาขา ' + D.br + ' ' : '') + 'ยังไม่มีข้อมูลในระบบ กรุณาให้ Admin อัปโหลดข้อมูล';
    return;
  }

  /* แถบข้อมูลด้านบน + รอบ 15 วัน */
  var m = curGroupMeta(F.g);
  var cyc = cycleStatus(m && m.ts);
  var nextDueTs = m && m.ts ? (m.ts + 15 * 86400000) : 0;
  $('#info').innerHTML = (D.ver === 'prev' ? '<b style="color:#ffffff;text-decoration:underline">[ฉบับก่อนหน้า]</b> · ' : '') +
    (D.br ? 'สาขา <b>' + esc(D.br) + '</b> · ' : '') + (m ? (F.g ? 'หมวด <b>' + esc(grpLabel(F.g)) + '</b>' : 'รวมทุกหมวด · อัปโหลดล่าสุด') + ' · อัปข้อมูลเข้าเมื่อ <b>' + esc(fmtTsTh(m.ts)) + '</b> โดย ' + esc(m.who || '–') +
      (m.file ? ' (' + esc(m.file) + ')' : '') : 'รวมทุกหมวด') +
    (D.me && !D.me.edit ? ' · <b style="color:#ffffff;text-decoration:underline">สิทธิ์: ดูอย่างเดียว</b>' : '');

  /* แท็บฉบับปัจจุบัน / ฉบับก่อนหน้า */
  var nCur = Object.keys(D.groups).filter(function (g) { return D.groups[g] && D.groups[g].cur; }).length;
  var nPrev = Object.keys(D.groups).filter(function (g) { return D.groups[g] && D.groups[g].prev; }).length;
  $('#verTabs').innerHTML =
    '<button type="button" class="tab' + (D.ver === 'cur' ? ' on' : '') + '" data-v="cur" role="tab" aria-selected="' + (D.ver === 'cur' ? 'true' : 'false') + '">ฉบับปัจจุบัน (' + nCur + ' หมวด)</button>' +
    '<button type="button" class="tab' + (D.ver === 'prev' ? ' on' : '') + '" data-v="prev" role="tab" aria-selected="' + (D.ver === 'prev' ? 'true' : 'false') + '"' + (nPrev ? '' : ' disabled title="จะมีเมื่อมีการอัปโหลดข้อมูลรอบใหม่ทับหมวดเดิม"') + '>ฉบับก่อนหน้า (' + nPrev + ' หมวด)</button>';

  $('#cycleBadgeBox').innerHTML = '<span class="cycle-badge ' + cyc.cls + '">' + esc(cyc.txt) + '</span>';
  $('#cycleBar').innerHTML =
    '<div><b>วันที่อัปข้อมูลเข้าระบบ:</b> ' + (m && (m.rep || m.ts) ? '<b>' + esc(fmtDateSlash(m.rep || m.ts, false)) + '</b> (' + esc(fmtTsTh(m.ts)) + ')' : '–') +
    (nextDueTs ? ' &nbsp;·&nbsp; <b>กำหนดอัปเดตรอบถัดไป (ทุก 15 วัน):</b> ' + esc(fmtDateSlash(nextDueTs, false)) : '') + '</div>' +
    '<div><b>วันที่ส่งออกข้อมูล (วันนี้):</b> <b>' + esc(fmtDateSlash(Date.now(), false)) + '</b></div>';

  /* ตัวเลือกหมวดสินค้า */
  $('#fGrp').innerHTML = '<option value="">ทุกหมวด (' + D.allGroups.length + ' หมวด)</option>' +
    D.allGroups.map(function (g) {
      var gm = D.ver === 'prev' ? D.groups[g].prev : D.groups[g].cur;
      var cnt = gm && gm.rows ? gm.rows.length : 0;
      return '<option value="' + esc(g) + '"' + (F.g === g ? ' selected' : '') + '>' + esc(grpLabel(g)) + ' (' + nf0.format(cnt) + ' รายการ)</option>';
    }).join('');

  /* ชิปกรองตามรายการแนะนำ */
  var baseForChips = D.items.filter(function (x) { return !F.g || x.g === F.g; });
  var recCounts = { '': baseForChips.length };
  REC_OPTS.forEach(function (k) { recCounts[k] = 0; });
  baseForChips.forEach(function (x) {
    recCounts[x.recAct] = (recCounts[x.recAct] || 0) + 1;
  });
  $('#chips').innerHTML = REC_META.map(function (c) {
    var on = F.rec === c.k;
    return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-rec="' + esc(c.k) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      '<i style="background:' + c.c + '" aria-hidden="true"></i><span>' + esc(c.t) + '</span><b>' + nf0.format(recCounts[c.k] || 0) + '</b></button>';
  }).join('');

  /* คำนวณ KPI ของหมวดที่เลือก */
  var grpItems = baseForChips;
  var activeItems = grpItems.filter(function (x) { return x.qty > 0; });
  var inactiveCnt = grpItems.length - activeItems.length;
  var upCnt = grpItems.filter(function (x) { return x.recAct === 'ปรับขึ้น'; }).length;
  var downCnt = grpItems.filter(function (x) { return x.recAct === 'ปรับลง'; }).length;
  var consCnt = grpItems.filter(function (x) { return x.recAct === 'ฝากพิจารณา'; }).length;
  var constCnt = grpItems.filter(function (x) { return x.recAct === 'คงที่'; }).length;
  var adjTotal = upCnt + downCnt + consCnt;

  var projection = summarizePriceProjection(grpItems);
  var avgEx = projection.avgBeforeEx, avgInc = projection.avgBeforeInc;

  $('#kpis').innerHTML =
    '<div class="kpi"><div class="l">สินค้าในหมวดนี้ทั้งหมด</div><div class="v">' + nf0.format(grpItems.length) + '<small>รายการ</small></div><div class="s">เคลื่อนไหว ' + nf0.format(activeItems.length) + ' · ไม่เคลื่อนไหว ' + nf0.format(inactiveCnt) + '</div></div>' +
    '<div class="kpi"><div class="l">รายการที่ต้องปรับ/พิจารณา</div><div class="v" style="color:var(--bad)">' + nf0.format(adjTotal) + '<small>รายการ</small></div><div class="s">ปรับขึ้น ' + upCnt + ' · ปรับลง ' + downCnt + ' · ฝากพิจารณา ' + consCnt + ' · คงที่ ' + constCnt + '</div></div>' +
    '<div class="kpi"><div class="l">กำไรเฉลี่ยหักเดิม (ไม่รวม Vat)</div><div class="v">' + projectionPercent(avgEx) + '</div><div class="s">เฉพาะสินค้าที่มีสต็อกและต้นทุนคำนวณได้ (' + nf0.format(projection.eligibleCount) + ' รายการ)</div></div>' +
    '<div class="kpi"><div class="l">กำไรเฉลี่ยหัก Vat แล้ว (รวม Vat)</div><div class="v" style="color:var(--accent-text)">' + projectionPercent(avgInc) + '</div></div>' +
    '<div class="kpi"><div class="l">กำไรเฉลี่ยหลังใช้ราคาแนะนำ (รวม Vat)</div><div class="v">' + projectionPercent(projection.avgAfterInc) + '</div><div class="s">ราคาเปลี่ยน ' + projection.changedCount + ' รายการ · รอกรอกราคา ' + projection.missingPriceCount + ' รายการ</div></div>' +
    '<div class="kpi"><div class="l">รอบอัปเดตข้อมูล (ทุก 15 วัน)</div><div class="v" style="color:' + (cyc.cls === 'bad' ? 'var(--bad)' : cyc.cls === 'warn' ? 'var(--warn)' : 'var(--ok)') + '">' + (m && m.ts ? cyc.days + '<small>วันที่ผ่านมา</small>' : '–') + '</div><div class="s">' + (m && m.ts ? 'อัปเข้า ' + fmtDateSlash(m.rep || m.ts, false) + ' · ส่งออก ' + fmtDateSlash(Date.now(), false) : 'ยังไม่มีข้อมูล') + '</div></div>';

  /* แถบบนสุดของตาราง (แสดงวันที่อัปข้อมูลเข้า กับ วันที่ส่งออกข้อมูล) */
  var upDateStr = m ? fmtDateSlash(m.rep || m.ts, false) : fmtDateSlash(Date.now(), false);
  var exDateStr = fmtDateSlash(Date.now(), false);
  var sNote = stripOldNote((m && m.surveyNote) || D.surveyNote || '');
  $('#topUploadDate').textContent = 'อัปข้อมูลเข้า วันที่ ' + upDateStr;
  $('#topExportDate').textContent = 'ส่งออกข้อมูล วันที่ ' + exDateStr + (sNote ? ' · ' + sNote : '');
  var gCode = F.g;
  var gName = (D.names && D.names[gCode]) || '';
  $('#topSheetTitle').textContent = 'สำรวจราคาท้องตลาดหมวดสินค้า ' + (gCode ? gCode + (gName ? ' ' + gName : '') : 'ทุกหมวด') + (D.br ? ' · สาขา ' + D.br : '');

  /* ตารางรายการ */
  renderTable();

  /* กล่องสรุปท้ายรายงาน */
  $('#smActive').textContent = nf0.format(activeItems.length);
  $('#smAvgEx').textContent = projectionPercent(avgEx);
  $('#smAvgInc').textContent = projectionPercent(avgInc);
  $('#smAfterEx').textContent = projectionPercent(projection.avgAfterEx);
  $('#smAfterInc').textContent = projectionPercent(projection.avgAfterInc);
  $('#smTitle').textContent = 'สรุปการสำรวจ หมวด ' + (gCode ? gCode + (gName ? ' ' + gName : '') : 'ทั้งหมด');
  $('#smText').textContent = buildSummaryText(gCode, gName, grpItems.length, inactiveCnt, activeItems.length, adjTotal, upCnt, downCnt, consCnt, avgEx, avgInc, projection);
  $('#sigSurveyor').value = D.surveyor || '';
  $('#sigChecker').value = D.checker || '';
  $('#sigApprover').value = D.approver || '';
}

function buildSummaryText(gCode, gName, total, inactive, active, adjTotal, upCnt, downCnt, consCnt, avgEx, avgInc, projection) {
  var title = 'หมวด ' + (gCode ? gCode + (gName ? ' ' + gName : '') : 'สินค้า');
  var exPct = projectionPercent(avgEx), incPct = projectionPercent(avgInc);
  var text = '1) ภาพรวมสินค้า: ' + title + ' มีสินค้าในระบบ ' + total + ' รายการ แบ่งเป็นสินค้าเคลื่อนไหว ' + active +
    ' รายการ และสินค้าไม่เคลื่อนไหว ' + inactive + ' รายการ';
  text += '\n2) ผลการสำรวจ: มีข้อเสนอปรับ/พิจารณารวม ' + adjTotal + ' รายการ ประกอบด้วย ปรับขึ้น ' + upCnt +
    ' รายการ ปรับลง ' + downCnt + ' รายการ และฝากพิจารณา ' + consCnt + ' รายการ';
  text += '\n3) กำไรเฉลี่ยของสินค้าที่มีอยู่ (คงเหลือ > 0) ก่อนปรับราคา: กำไรเฉลี่ยที่ยังไม่หักภาษีมูลค่าเพิ่ม ' + exPct + ' และกำไรเฉลี่ยที่หักภาษีมูลค่าเพิ่มแล้ว ' + incPct;
  if (projection) {
    text += '\n4) หากใช้ราคาแนะนำ: มีสินค้าที่ราคาต่างจากปัจจุบัน ' + projection.changedCount + ' รายการ (มีสต็อก ' + projection.changedActiveCount +
      ' รายการ) กำไรเฉลี่ยที่ยังไม่หักภาษีมูลค่าเพิ่มเปลี่ยนจาก ' + projectionPercent(projection.avgBeforeEx) + ' เป็น ' + projectionPercent(projection.avgAfterEx) +
      ' และกำไรเฉลี่ยที่หักภาษีมูลค่าเพิ่มแล้วเปลี่ยนจาก ' + projectionPercent(projection.avgBeforeInc) + ' เป็น ' + projectionPercent(projection.avgAfterInc) + '.';
  }
  return text;
}

function recClass(recAct) {
  if (recAct === 'คงที่') return 'rec-const';
  if (recAct === 'ปรับขึ้น') return 'rec-up';
  if (recAct === 'ปรับลง') return 'rec-down';
  if (recAct === 'ฝากพิจารณา') return 'rec-cons';
  if (recAct === 'สินค้าไม่เคลื่อนไหว') return 'rec-inact';
  return '';
}

function fixHead() {
  var rows = $('#mt thead').rows, t = 0;
  for (var i = 0; i < rows.length; i++) {
    for (var j = 0; j < rows[i].cells.length; j++) rows[i].cells[j].style.top = t + 'px';
    t += rows[i].getBoundingClientRect().height;
  }
}
window.addEventListener('resize', fixHead);
window.addEventListener('load', fixHead);

function gLink(x) {
  var q = encodeURIComponent((String(x.code || '').trim() + ' ' + String(x.name || '').trim()).trim());
  return '<td><a class="gbtn" href="https://www.google.com/search?q=' + q + '" target="_blank" rel="noopener noreferrer" title="ค้นหา ' + esc(x.code) + ' ' + esc(x.name) + ' ใน Google"><svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg><span>Google</span></a></td>';
}

function renderTable() {
  var list = filteredItems();
  var edit = !!(D.me && D.me.edit) && D.ver === 'cur';
  var maxPage = Math.max(0, Math.ceil(list.length / PAGE) - 1);
  if (F.page > maxPage) F.page = maxPage;
  var start = F.page * PAGE;
  var slice = list.slice(start, start + PAGE);

  $('#dtNote').textContent = 'แสดง ' + nf0.format(slice.length) + ' จาก ' + nf0.format(list.length) + ' รายการ';
  $('#pgInfo').textContent = list.length ? 'หน้า ' + (F.page + 1) + ' / ' + (maxPage + 1) + ' (' + (start + 1) + '–' + (start + slice.length) + ')' : '0 รายการ';
  $('#pgPrev').disabled = F.page <= 0;
  $('#pgNext').disabled = F.page >= maxPage;

  if (!slice.length) {
    $('#mtBody').innerHTML = '<tr><td colspan="19" class="muted" style="padding:28px;text-align:center">ไม่พบรายการตามตัวกรองที่เลือก</td></tr>';
    if (window.WorkspaceUI) WorkspaceUI.marketRows();
    fixHead();
    return;
  }

  $('#mtBody').innerHTML = slice.map(function (x, idx) {
    var no = start + idx + 1;
    var rCls = recClass(x.recAct);
    var inact = x.recAct === 'สินค้าไม่เคลื่อนไหว';
    var oDash = inact || x.mktMin === '-';
    var pDash = inact || x.mktMax === '-';
    var update = latestUpdate(x);
    var chgColor = /^>/.test(x.chgTxt) ? 'color:var(--bad);font-weight:600' : (/^</.test(x.chgTxt) ? 'color:var(--ok);font-weight:600' : '');

    if (!edit) {
      return '<tr>' +
        '<td><b>' + no + '</b></td>' +
        '<td class="code">' + esc(x.code) + '</td>' +
        '<td class="nm">' + esc(x.name) + '</td>' +
        '<td>' + nf0.format(x.qty) + '</td>' +
        '<td class="chg" style="' + chgColor + '">' + esc(update.text) + '</td>' +
        '<td class="c-cost">' + money(x.cost) + '</td>' +
        '<td class="c-price">' + money(x.price) + '</td>' +
        '<td>' + money(x.profitEx) + '</td>' +
        '<td>' + pctF(x.marginEx) + '</td>' +
        '<td class="c-vat">' + money(x.costVat) + '</td>' +
        '<td>' + money(x.profitInc) + '</td>' +
        '<td>' + pctF(x.marginInc) + '</td>' +
        '<td class="c-p30">' + money(x.price30) + '</td>' +
        '<td class="c-mkt' + (oDash ? ' mkt-dash' : '') + '">' + (x.mktMin === '' ? '' : (typeof x.mktMin === 'number' ? money(x.mktMin) : esc(x.mktMin))) + '</td>' +
        '<td class="c-mkt' + (pDash ? ' mkt-dash' : '') + '">' + (x.mktMax === '' ? '' : (typeof x.mktMax === 'number' ? money(x.mktMax) : esc(x.mktMax))) + '</td>' +
        '<td class="' + rCls + '">' + esc(x.recAct) + '</td>' +
        '<td class="' + rCls + '">' + (x.recPrice === '' ? '' : money(x.recPrice)) + projectionNote(x) + '</td>' +
        '<td>' + esc(x.editNote) + '</td>' +
        gLink(x) +
      '</tr>';
    }

    var opts = (REC_OPTS.indexOf(x.recAct) < 0 ? [x.recAct].concat(REC_OPTS) : REC_OPTS).map(function (o) {
      return '<option value="' + esc(o) + '"' + (x.recAct === o ? ' selected' : '') + '>' + esc(o) + '</option>';
    }).join('');

    return '<tr data-idx="' + x.i + '">' +
      '<td><b>' + no + '</b></td>' +
      '<td class="code">' + esc(x.code) + '</td>' +
      '<td class="nm">' + esc(x.name) + '</td>' +
      '<td>' + nf0.format(x.qty) + '</td>' +
      '<td class="chg" style="' + chgColor + '">' + esc(update.text) + '</td>' +
      '<td class="c-cost">' + money(x.cost) + '</td>' +
      '<td class="c-price">' + money(x.price) + '</td>' +
      '<td>' + money(x.profitEx) + '</td>' +
      '<td>' + pctF(x.marginEx) + '</td>' +
      '<td class="c-vat">' + money(x.costVat) + '</td>' +
      '<td>' + money(x.profitInc) + '</td>' +
      '<td>' + pctF(x.marginInc) + '</td>' +
      '<td class="c-p30">' + money(x.price30) + '</td>' +
      '<td class="c-mkt' + (oDash ? ' mkt-dash' : '') + '"><input type="text" class="in-cell" data-f="8" aria-label="ราคาท้องตลาดต่ำสุด ' + esc(x.name) + '" value="' + esc(x.mktMin) + '" placeholder="-"></td>' +
      '<td class="c-mkt' + (pDash ? ' mkt-dash' : '') + '"><input type="text" class="in-cell" data-f="9" aria-label="ราคาท้องตลาดสูงสุด ' + esc(x.name) + '" value="' + esc(x.mktMax) + '" placeholder="-"></td>' +
      '<td class="' + rCls + '"><select class="in-cell" data-f="10" aria-label="รายการแนะนำ ' + esc(x.name) + '">' + opts + '</select></td>' +
      '<td class="' + rCls + '"><input type="text" class="in-cell" data-f="11" aria-label="ราคาแนะนำ ' + esc(x.name) + '" value="' + esc(x.recPrice) + '" placeholder="ราคา">' + projectionNote(x) + '</td>' +
      '<td><input type="text" class="in-cell left" data-f="12" aria-label="หมายเหตุการแก้ไข ' + esc(x.name) + '" value="' + esc(x.editNote) + '" placeholder="หมายเหตุ"></td>' +
      gLink(x) +
    '</tr>';
  }).join('');
  if (window.WorkspaceUI) WorkspaceUI.marketRows();
  fixHead();
}

/* ---------- แก้ไขค่าในตารางโดยตรง ---------- */
$('#mtBody').addEventListener('change', function (e) {
  if (!D.me || !D.me.edit || D.ver !== 'cur') return;
  var el = e.target.closest('[data-f]'); if (!el) return;
  var tr = el.closest('tr[data-idx]'); if (!tr) return;
  var idx = Number(tr.dataset.idx), item = D.items[idx]; if (!item) return;
  var f = Number(el.dataset.f), v = el.value.trim(), keepFocus = document.activeElement === el;
  if (f === 8 || f === 9 || f === 11) {
    if (v !== '' && v !== '-') {
      var parsed = marketNumber(v);
      if (parsed === null || parsed < 0) {
        toast('กรุณากรอกราคาเป็นตัวเลขตั้งแต่ 0 ขึ้นไป หรือเว้นว่าง', true);
        el.value = item.raw[f] == null ? '' : item.raw[f];
        el.focus(); return;
      }
      v = parsed;
    }
    var min = f === 8 ? marketNumber(v) : marketNumber(item.raw[8]);
    var max = f === 9 ? marketNumber(v) : marketNumber(item.raw[9]);
    if ((f === 8 || f === 9) && min !== null && max !== null && min > max) {
      toast('ราคาต่ำสุดต้องไม่มากกว่าราคาสูงสุด', true);
      el.value = item.raw[f] == null ? '' : item.raw[f];
      el.focus(); return;
    }
  }
  item.raw[f] = v;
  D.items[idx] = calcItem(item.raw, idx);
  DIRTY = true;
  $('#bSaveEdits').classList.remove('hidden');
  saveLocalState();
  renderAll();
  if(keepFocus){var replacement=document.querySelector('#mtBody tr[data-idx="'+idx+'"] [data-f="'+f+'"]');if(replacement)replacement.focus({preventScroll:true});}
});

$('#bSaveEdits').addEventListener('click', function () {
  busy(this, async function () {
    var ok = await syncThen('บันทึกข้อมูลการสำรวจราคาตลาดแล้ว');
    if (ok) { $('#bSaveEdits').classList.toggle('hidden', !DIRTY); if(!DIRTY)$('#fQ').focus({preventScroll:true}); }
  });
});

['#sigSurveyor', '#sigChecker', '#sigApprover'].forEach(function (sel) {
  $(sel).addEventListener('change', function () {
    if (!D.me || !D.me.edit || D.ver !== 'cur') return;
    D.surveyor = $('#sigSurveyor').value.trim();
    D.checker = $('#sigChecker').value.trim();
    D.approver = $('#sigApprover').value.trim();
    syncToServer();
  });
});

/* ---------- คำนวณรายการแนะนำอัตโนมัติ ---------- */
$('#bAutoRec').addEventListener('click', function () {
  if (!D.me || !D.me.edit || D.ver !== 'cur') return;
  var list = filteredItems();
  if (!list.length) return;
  var cnt = 0, skipped = 0;
  list.forEach(function (x) {
    var r = x.raw;
    if (x.qty <= 0) {
      if (r[10] !== 'สินค้าไม่เคลื่อนไหว') { r[10] = 'สินค้าไม่เคลื่อนไหว'; r[11] = ''; cnt++; }
      return;
    }
    var mn = (typeof x.mktMin === 'number' && isFinite(x.mktMin)) ? x.mktMin : null;
    var mx = (typeof x.mktMax === 'number' && isFinite(x.mktMax)) ? x.mktMax : null;
    if ((mn === null && mx === null) || (mn !== null && mx !== null && mn > mx)) { skipped++; return; }
    var nextAct = 'คงที่', nextP = '';
    if (mx !== null && x.price > mx) {
      if (mx >= x.costVat) { nextAct = 'ปรับลง'; nextP = mx; }
      else { nextAct = 'ฝากพิจารณา'; nextP = ''; }
    } else if (mn !== null && x.price < mn) {
      nextAct = 'ปรับขึ้น'; nextP = mn;
    }
    if (r[10] !== nextAct || String(r[11] || '') !== String(nextP)) {
      r[10] = nextAct; r[11] = nextP; cnt++;
    }
  });
  rebuildItems();
  renderAll();
  if (cnt) syncThen('คำนวณรายการแนะนำอัตโนมัติแล้ว · เปลี่ยนแปลง ' + nf0.format(cnt) + ' รายการ' + (skipped ? ' · ข้ามรายการที่ราคาตลาดไม่ครบหรือไม่ถูกต้อง ' + nf0.format(skipped) + ' รายการ' : ''));
  else toast('ไม่มีรายการแนะนำที่เปลี่ยนแปลง' + (skipped ? ' · ข้ามรายการที่ยังไม่มีราคาตลาดที่ใช้คำนวณได้ ' + nf0.format(skipped) + ' รายการ' : ''));
});

/* ---------- ตัวกรองและเปลี่ยนหน้า ---------- */
$('#verTabs').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-v]'); if (!b || b.disabled) return;
  D.ver = b.dataset.v; F.page = 0;
  rebuildItems(); renderAll();
});
$('#brSel').addEventListener('change', function () {
  setBranch(this.value); F.g = ''; F.page = 0; F.rec = '';
  rebuildItems(); renderAll();
});
$('#fGrp').addEventListener('change', function () { F.g = this.value; F.page = 0; renderAll(); });
$('#fMove').addEventListener('change', function () { F.move = this.value; F.page = 0; renderAll(); });
$('#fQ').addEventListener('input', function () { F.q = this.value; F.page = 0; renderTable(); });
$('#chips').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-rec]'); if (!b) return;
  F.rec = b.dataset.rec; F.page = 0; renderAll();
});
$('#pgPrev').addEventListener('click', function () { if (F.page > 0) { F.page--; renderTable(); } });
$('#pgNext').addEventListener('click', function () { F.page++; renderTable(); });
$('#bReload').addEventListener('click', function () {
  if (DIRTY && !confirm('ยังมีการแก้ไขที่ไม่ได้บันทึก ต้องการโหลดข้อมูลจากเซิร์ฟเวอร์และละทิ้งการแก้ไขหรือไม่?')) return;
  DIRTY = false; saveLocalState();
  busy(this, async function () { await SAVE_CHAIN; if (await load()) toast('รีเฟรชข้อมูลล่าสุดแล้ว'); });
});
window.addEventListener('beforeunload', function (e) {
  flushLocalState();
  if (!DIRTY) return;
  e.preventDefault(); e.returnValue = '';
});
window.addEventListener('pagehide', flushLocalState);
document.addEventListener('visibilitychange', function () { if (document.hidden) flushLocalState(); });
$('#bEmptyUpload').addEventListener('click', function () { $('#bUpload').click(); });

/* ---------- อ่านไฟล์ Excel ที่อัปโหลด (รองรับทั้งไฟล์สำรวจราคาตลาด และไฟล์รายงานวิเคราะห์การขาย POS) ---------- */
function normH(s) { return String(s == null ? '' : s).replace(/[\s\u00a0]+/g, '').toLowerCase(); }
function parseDateCell(v) {
  if (v === null || v === undefined || v === '' || v === '-') return '-';
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    var y = +m[3]; if (y > 2400) y -= 543;
    return y + '-' + pad2(+m[2]) + '-' + pad2(+m[1]);
  }
  return s;
}

function parseMarketWorkbook(sheets, defGrp, defName, upDateIso) {
  var groups = Object.create(null), names = Object.create(null), surveyNote = '', totalRead = 0;
  (sheets || []).forEach(function (sh) {
    var grid = sh.grid || [], shName = String(sh.name || '').trim();
    if (!grid.length) return;

    var grpCode = '', grpName = '', repDate = upDateIso || todayIso(), sNote = '';
    for (var r = 0; r < Math.min(grid.length, 6); r++) {
      var rowStr = (grid[r] || []).map(function (x) { return String(x == null ? '' : x); }).join(' ');
      var m1 = rowStr.match(/วันที่\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
      if (m1) repDate = parseDateCell(m1[1]);
      var mSurv = rowStr.match(/(สุ่มสำรวจ[^,\r\n]*)/);
      if (mSurv) sNote = mSurv[1].trim();
      var mCat = rowStr.match(/หมวด(?:สินค้า)?\s*([A-Za-z0-9_-]+)\s+([^,\r\n]+)/);
      if (mCat) { grpCode = mCat[1].trim().toUpperCase(); grpName = mCat[2].trim(); }
    }
    if (!grpCode) {
      if (/^[A-Za-z0-9_-]{1,12}$/.test(shName)) grpCode = shName.toUpperCase();
      else {
        var mSh = shName.match(/^(\d+|[A-Za-z]+\d+)\s*(.*)$/);
        if (mSh) { grpCode = mSh[1].toUpperCase(); if (mSh[2] && !grpName) grpName = mSh[2].trim(); }
      }
    }
    if (!grpCode) grpCode = (defGrp || '34').toUpperCase();
    if (!grpName && defName) grpName = defName;
    if (grpName) names[grpCode] = grpName;
    if (sNote) surveyNote = sNote;

    /* ตรวจว่าเป็นไฟล์สำรวจราคาตลาด (แบบ 34ผลิตภัณฑ์ดูแลผ้า.xlsx) หรือไฟล์รายงานสต็อก POS */
    var isMarketFmt = false, dataStartRow = -1, colMap = {};
    for (var i = 0; i < Math.min(grid.length, 12); i++) {
      var r0 = grid[i] || [];
      var joined = r0.map(normH).join('|');
      if (joined.indexOf('ราคาท้องตลาด') >= 0 || joined.indexOf('รายการแนะนำ') >= 0 || joined.indexOf('ต้นทุน+vat') >= 0) {
        isMarketFmt = true;
        dataStartRow = i + 3;
        break;
      }
    }
    if (isMarketFmt) {
      while (dataStartRow < grid.length) {
        var rr = grid[dataStartRow] || [];
        var c0 = normH(rr[0]), c4 = normH(rr[4]), c14 = normH(rr[14]);
        if (c4 === 'การปรับ' || c14 === 'ต่ำสุด' || (!rr[1] && !rr[2])) { dataStartRow++; continue; }
        break;
      }
      for (var r2 = dataStartRow; r2 < grid.length; r2++) {
        var row = grid[r2] || [];
        var code = String(row[1] == null ? '' : row[1]).trim();
        var name = String(row[2] == null ? '' : row[2]).trim();
        if (!code || !name || /กำไรเฉลี่ย|สรุปการสำรวจ|ลงชื่อ/.test(name)) continue;
        var qty = Number(String(row[3] == null ? '0' : row[3]).replace(/,/g, ''));
        if (!isFinite(qty)) qty = 0;
        var chgTxt = String(row[4] == null || row[4] === '' ? '-' : row[4]).trim();
        var chgDate = parseDateCell(row[5]);
        if (chgTxt === 'นำเข้าข้อมูล') { chgTxt = '-'; chgDate = '-'; }
        if (chgTxt === 'อัปเดตจากไฟล์') chgTxt = '-';
        var cost = Number(String(row[6] == null ? '0' : row[6]).replace(/,/g, '')) || 0;
        var price = Number(String(row[7] == null ? '0' : row[7]).replace(/,/g, '')) || 0;
        var mktMin = marketCell(row[14]);
        var mktMax = marketCell(row[15]);
        var recAct = String(row[16] == null || row[16] === '' ? (qty <= 0 ? 'สินค้าไม่เคลื่อนไหว' : 'คงที่') : row[16]).trim();
        var recPrice = marketCell(row[17]);
        var editNote = String(row[18] == null ? '' : row[18]).trim();
        (groups[grpCode] || (groups[grpCode] = { g: grpCode, rep: repDate, surveyNote: sNote, items: [] })).items.push({
          g: grpCode, code: code, name: name, qty: qty, chgTxt: chgTxt, chgDate: chgDate,
          cost: cost, price: price, mktMin: mktMin, mktMax: mktMax, recAct: recAct, recPrice: recPrice, editNote: editNote, rep: repDate, hasMarketCols: true
        });
        totalRead++;
      }
      return;
    }

    /* ไฟล์ Allproduct: ทุกสาขาอยู่ในชีตเดียว แต่ละสาขามีคอลัมน์ "<รหัสสาขา>ปรับ" ตามด้วย "ขาย" ของสาขานั้น
       คอลัมน์ "อัพเดท" = วันที่อัปเดตล่าสุดของสินค้า · แตกเป็นรายการต่อสาขา แล้วให้เลือกสาขาที่ตรงตอนอัปโหลด */
    var apHdr = -1, apC = {}, apBr = [];
    for (var ah = 0; ah < Math.min(grid.length, 15) && apHdr < 0; ah++) {
      var ahr = grid[ah] || [], am = Object.create(null), brs = [];
      ahr.forEach(function (cell, j) {
        var raw = String(cell == null ? '' : cell).replace(/[\s\u00a0]+/g, ''), k = raw.toLowerCase();
        if (k && am[k] === undefined) am[k] = j;
        var mb = /^([A-Za-z0-9]{1,8})ปรับ$/.exec(raw);
        if (mb) {
          var pc = -1;
          for (var j2 = j + 1; j2 < ahr.length; j2++) { if (normH(ahr[j2]) === 'ขาย') { pc = j2; break; } }
          if (pc >= 0) brs.push({ name: mb[1].toUpperCase(), chg: j, price: pc });
        }
      });
      if (brs.length && am['ชื่อสินค้า'] !== undefined && (am['รหัส'] !== undefined || am['barcode'] !== undefined) && am['ต้นทุน'] !== undefined) {
        apHdr = ah; apBr = brs;
        apC = { g: am['กลุ่ม'], code: am['รหัส'], bar: am['barcode'], name: am['ชื่อสินค้า'], qty: am['จำนวน'], cost: am['ต้นทุน'], upd: am['อัพเดท'] !== undefined ? am['อัพเดท'] : am['อัปเดต'] };
      }
    }
    if (apHdr >= 0) {
      var cellStr = function (row, j) { return j === undefined || row[j] == null ? '' : String(row[j]).replace(/\u00a0/g, ' ').trim(); };
      for (var ar = apHdr + 1; ar < grid.length; ar++) {
        var arow = grid[ar] || [];
        var aname = cellStr(arow, apC.name), acode = cellStr(arow, apC.code) || cellStr(arow, apC.bar);
        if (!aname || !acode) continue;
        var ag = (cellStr(arow, apC.g) || grpCode).toUpperCase();
        var aqty = Number(cellStr(arow, apC.qty).replace(/,/g, '')) || 0;
        var acost = Number(cellStr(arow, apC.cost).replace(/,/g, '')) || 0;
        var adate = apC.upd !== undefined ? parseDateCell(arow[apC.upd]) : '-';
        apBr.forEach(function (b) {
          var aprice = Number(cellStr(arow, b.price).replace(/,/g, '')) || 0;
          var achg = cellStr(arow, b.chg).replace(/^([<>])\s*(ปรับ(?:ลง|ขึ้น))\s*เดิม\s*([\d.,]+)\s*(ลง|ขึ้น)\s*([\d.,]+)/, '$1 $2\nเดิม $3 $4 $5') || '-';
          (groups[ag] || (groups[ag] = { g: ag, rep: repDate, surveyNote: sNote, items: [] })).items.push({
            g: ag, code: acode, name: aname, sourceBranch: b.name, qty: aqty, chgTxt: achg, chgDate: adate,
            cost: acost, price: aprice, mktMin: '', mktMax: '', recAct: aqty <= 0 ? 'สินค้าไม่เคลื่อนไหว' : 'คงที่', recPrice: '', editNote: '', rep: repDate, hasMarketCols: false
          });
          totalRead++;
        });
      }
      return;
    }

    /* กรณีเป็นไฟล์รายงานวิเคราะห์การขาย / สต็อกสินค้าจาก POS */
    var hdrRow = -1, idx = {};
    var aliases = {
      g: ['กลุ่ม', 'หมวด'], code: ['รหัส', 'บาร์โค้ด', 'เลขบาร์'], name: ['ชื่อสินค้า', 'ชื่อรายการ'],
      branch: ['สาขา', 'ชื่อสาขา', 'branch'],
      chgTxt: ['การปรับ', 'การปรับราคา', 'อัปเดตล่าสุด', 'อัพเดตล่าสุด'],
      chgDate: ['วันที่ปรับราคา', 'วันที่อัปเดต', 'วันที่อัพเดต', 'วันที่ปรับปรุง', 'วันที่'],
      oldPrice: ['ราคาขายเดิม', 'ราคาเดิม'],
      qty: ['คงเหลือ', 'จำนวนคงเหลือสินค้า', 'จำนวน'], cost: ['ต้นทุนล่าสุด', 'ต้นทุน', 'ทุน'], price: ['ราคาขาย', 'ราคา']
    };
    for (var h = 0; h < Math.min(grid.length, 15); h++) {
      var hr = grid[h] || [], hmap = Object.create(null), candidate = {};
      hr.forEach(function (cell, j) { var k = normH(cell); if (k && hmap[k] === undefined) hmap[k] = j; });
      Object.keys(aliases).forEach(function (key) {
        aliases[key].forEach(function (al) {
          var j = hmap[normH(al)];
          if (j !== undefined && candidate[key] === undefined) candidate[key] = j;
        });
      });
      if (candidate.code !== undefined && candidate.name !== undefined && candidate.cost !== undefined && candidate.price !== undefined) { idx = candidate; hdrRow = h; break; }
    }
    if (hdrRow < 0) return;
    for (var pr = hdrRow + 1; pr < grid.length; pr++) {
      var prow = grid[pr] || [];
      var pname = String(prow[idx.name] == null ? '' : prow[idx.name]).trim();
      if (!pname) continue;
      var pg = (idx.g !== undefined && prow[idx.g] != null ? String(prow[idx.g]).trim().toUpperCase() : '') || grpCode;
      var pcode = idx.code !== undefined && prow[idx.code] != null ? String(prow[idx.code]).trim() : '';
      if (!pcode) continue;
      var pbranch = idx.branch !== undefined && prow[idx.branch] != null ? String(prow[idx.branch]).replace(/\s+/g, ' ').trim() : '';
      var pqty = idx.qty !== undefined ? (Number(String(prow[idx.qty] || '0').replace(/,/g, '')) || 0) : 0;
      var pcost = idx.cost !== undefined ? (Number(String(prow[idx.cost] || '0').replace(/,/g, '')) || 0) : 0;
      var pprice = idx.price !== undefined ? (Number(String(prow[idx.price] || '0').replace(/,/g, '')) || 0) : 0;
      var pchg = idx.chgTxt !== undefined ? String(prow[idx.chgTxt] || '-').trim() : '-';
      var pdate = idx.chgDate !== undefined ? parseDateCell(prow[idx.chgDate]) : '-';
      var pold = idx.oldPrice !== undefined ? marketNumber(prow[idx.oldPrice]) : null;
      if (pchg === '-' && pold !== null && Math.abs(pold - pprice) >= 0.005) {
        pchg = (pprice > pold ? '> ปรับขึ้น\nเดิม ' + pold + ' ขึ้น ' + pprice : '< ปรับลง\nเดิม ' + pold + ' ลง ' + pprice);
      }
      (groups[pg] || (groups[pg] = { g: pg, rep: repDate, surveyNote: sNote, items: [] })).items.push({
        g: pg, code: pcode, name: pname, sourceBranch: pbranch, qty: pqty, chgTxt: pchg, chgDate: pdate,
        cost: pcost, price: pprice, mktMin: '', mktMax: '', recAct: pqty <= 0 ? 'สินค้าไม่เคลื่อนไหว' : 'คงที่', recPrice: '', editNote: '', rep: repDate, hasMarketCols: false
      });
      totalRead++;
    }
  });
  return { groups: groups, names: names, surveyNote: surveyNote, totalRead: totalRead };
}

/* รวมข้อมูลที่อัปโหลดเข้ากับหมวดเดิม + ตรวจจับการปรับราคาขายอัตโนมัติ (เดิม X ขึ้น/ลง Y) */
function mergeUploadedGroup(g, newItems, fileName, repDate, ts, sNote) {
  var oldCur = D.groups[g] && D.groups[g].cur ? D.groups[g].cur : null;
  var oldMap = Object.create(null);
  if (oldCur && Array.isArray(oldCur.rows)) {
    oldCur.rows.forEach(function (r) {
      var k = codeKey(r[1] || r[2]);
      if (k) oldMap[k] = r;
    });
  }
  var mergedRows = [], priceChangedCnt = 0;
  newItems.forEach(function (it) {
    var k = codeKey(it.code || it.name);
    var old = oldMap[k];
    var chgTxt = it.chgTxt || '-';
    var chgDate = it.chgDate || '-';
    var mktMin = it.mktMin !== undefined ? it.mktMin : '';
    var mktMax = it.mktMax !== undefined ? it.mktMax : '';
    var recAct = it.recAct || (it.qty <= 0 ? 'สินค้าไม่เคลื่อนไหว' : 'คงที่');
    var recPrice = it.recPrice !== undefined ? it.recPrice : '';
    var editNote = it.editNote || '';

    if (old) {
      var oldPrice = Number(old[7]) || 0;
      var newPrice = Number(it.price) || 0;
      if (newPrice !== oldPrice && chgTxt === '-') {
        chgTxt = (newPrice > oldPrice ? '> ปรับขึ้น\nเดิม ' + oldPrice + ' ขึ้น ' + newPrice : '< ปรับลง\nเดิม ' + oldPrice + ' ลง ' + newPrice);
        chgDate = repDate || todayIso();
        priceChangedCnt++;
      } else if (chgTxt === '-' && chgDate === '-' && old[4] && old[4] !== '-') {
        chgTxt = old[4];
        chgDate = old[5] || '-';
      }
      if (!it.hasMarketCols) {
        if (mktMin === '' && old[8] !== '') mktMin = old[8];
        if (mktMax === '' && old[9] !== '') mktMax = old[9];
        if (old[10]) {
          if (it.qty <= 0) recAct = 'สินค้าไม่เคลื่อนไหว';
          else if (old[10] === 'สินค้าไม่เคลื่อนไหว') recAct = 'คงที่';
          else recAct = old[10];
        }
        if (recPrice === '' && old[11] !== '' && it.qty > 0) recPrice = old[11];
        if (!editNote && old[12]) editNote = old[12];
      }
    }

    var newRow = [
      g, it.code, it.name, it.qty, chgTxt, chgDate,
      Math.round((Number(it.cost) || 0) * 10000) / 10000,
      Math.round((Number(it.price) || 0) * 100) / 100,
      mktMin, mktMax, recAct, recPrice, editNote, repDate || todayIso()
    ];
    sanitizeChg(newRow);      // การปรับไม่ตรงกับราคาขาย → ลบการปรับ+วันที่
    mergedRows.push(newRow);
  });

  D.groups[g] = {
    cur: {
      ts: ts,
      who: (D.me && D.me.name) || 'Admin',
      file: fileName,
      rep: repDate || todayIso(),
      surveyNote: sNote || (oldCur && oldCur.surveyNote) || D.surveyNote || '',
      count: mergedRows.length,
      rows: mergedRows
    },
    prev: oldCur
  };
  return priceChangedCnt;
}

/* ---------- หน้าต่างอัปโหลดไฟล์ Excel ---------- */
var UP = null;
var UP_READ_ID = 0;

function uploadSourceBranches(groups) {
  var sources = Object.create(null);
  Object.keys(groups).forEach(function (g) {
    groups[g].items.forEach(function (it) {
      var name = String(it.sourceBranch || '').trim(), key = brKey(name);
      if (!sources[key]) sources[key] = { key: key, name: name, count: 0 };
      sources[key].count++;
    });
  });
  return Object.keys(sources).sort().map(function (key) { return sources[key]; });
}

function filterUploadGroups(groups, sourceKey) {
  var selected = Object.create(null), totalRows = 0;
  Object.keys(groups).forEach(function (g) {
    var grp = groups[g], items = grp.items.filter(function (it) { return brKey(it.sourceBranch) === sourceKey; });
    if (!items.length) return;
    selected[g] = { g: grp.g, rep: grp.rep, surveyNote: grp.surveyNote, items: items };
    totalRows += items.length;
  });
  return { groups: selected, totalRows: totalRows };
}

function uploadDestinationName() {
  return $('#upBr').value === '__new__' ? $('#upBrNew').value.replace(/\s+/g, ' ').trim() : $('#upBr').value;
}

function selectUploadDestination() {
  if (!UP) return;
  var source = UP.sources.filter(function (s) { return s.key === $('#upSourceBr').value; })[0];
  if (!source || !source.name) return;
  var existing = findBranch(source.name);
  $('#upBr').value = existing || '__new__';
  $('#upBrNew').value = existing ? '' : source.name;
  $('#upBrNewW').classList.toggle('hidden', !!existing);
}

function matchUploadSource() {
  if (!UP) return;
  if (UP.sources.length === 1 && !UP.sources[0].name) return;
  var key = brKey(uploadDestinationName());
  var matching = UP.sources.filter(function (s) { return s.name && s.key === key; })[0];
  $('#upSourceBr').value = matching ? matching.key : '__choose__';
}

function renderUploadPreview() {
  if (!UP) return;
  var sourceKey = $('#upSourceBr').value;
  var selection = filterUploadGroups(UP.allGroups, sourceKey);
  UP.groups = selection.groups;
  UP.sourceKey = sourceKey;
  UP.totalRows = selection.totalRows;
  var gKeys = Object.keys(UP.groups).sort();
  var source = UP.sources.filter(function (s) { return s.key === sourceKey; })[0];
  var target = uploadDestinationName();
  var matches = !source || !source.name || brKey(source.name) === brKey(target);
  var targetNames = D.store[findBranch(target) || target];
  $('#pv').innerHTML =
    '<div><b>ข้อมูลจากสาขา: ' + esc(source ? (source.name || 'ไม่ระบุสาขาในไฟล์') : 'กรุณาเลือกสาขาที่ตรงกัน') + '</b> → <b>บันทึกที่สาขา: ' + esc(target || 'กรุณาระบุสาขาปลายทาง') + '</b></div>' +
    (!matches ? '<div class="err">สาขาปลายทางต้องตรงกับสาขาที่เลือกจากไฟล์</div>' : '') +
    '<div class="pvk">' +
      '<div><b>' + gKeys.length + '</b><span>หมวดสินค้าที่เลือก</span></div>' +
      '<div><b>' + nf0.format(UP.totalRows) + '</b><span>รายการของสาขาที่เลือก</span></div>' +
      '<div><b>' + esc(fmtDateSlash($('#upDate').value || UP.repDate, false)) + '</b><span>วันที่อัปข้อมูลเข้า</span></div>' +
    '</div>' +
    '<div class="muted">อ่านจากไฟล์ทั้งหมด ' + nf0.format(UP.totalRead) + ' รายการ · นำเข้าเฉพาะสาขาที่เลือก ' + nf0.format(UP.totalRows) + ' รายการ</div>' +
    '<div class="muted">หมวดที่จะอัปเดต: ' + gKeys.map(function (g) {
      var nm = UP.names[g] || (targetNames && targetNames.names[g]) || '';
      return '<b>' + esc(g + (nm ? ' · ' + nm : '')) + '</b> (' + nf0.format(UP.groups[g].items.length) + ' รายการ)';
    }).join(', ') + '</div>';
  $('#pv').classList.remove('hidden');
  $('#upSave').classList.toggle('hidden', !gKeys.length);
  $('#upSave').disabled = !gKeys.length || !target || !matches;
}

$('#bUpload').addEventListener('click', function () {
  UP_READ_ID++;
  UP = null;
  var bks = Object.keys(D.store).sort();
  $('#upBr').innerHTML = bks.map(function (b) { return '<option value="' + esc(b) + '"' + (D.br === b ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') +
    '<option value="__new__"' + (bks.length ? '' : ' selected') + '>+ เพิ่มสาขาใหม่…</option>';
  $('#upBrNew').value = '';
  $('#upBrNewW').classList.toggle('hidden', $('#upBr').value !== '__new__');
  $('#upDate').value = todayIso();
  $('#upDefGrp').value = F.g || '';
  $('#upDefName').value = (F.g && D.names[F.g]) || '';
  $('#upErr').textContent = '';
  $('#upSourceBr').innerHTML = '';
  $('#upSourceBrW').classList.add('hidden');
  $('#pv').classList.add('hidden');
  $('#upSave').classList.add('hidden');
  $('#upFile').value = '';
  $('#upDlg').classList.remove('hidden');
});
$('#upBr').addEventListener('change', function () {
  $('#upBrNewW').classList.toggle('hidden', this.value !== '__new__');
  matchUploadSource();
  renderUploadPreview();
});
$('#upSourceBr').addEventListener('change', function () { selectUploadDestination(); renderUploadPreview(); });
$('#upBrNew').addEventListener('input', function () { matchUploadSource(); renderUploadPreview(); });
$('#upDate').addEventListener('change', renderUploadPreview);
$('#upCancel').addEventListener('click', function () { UP_READ_ID++; UP = null; $('#upDlg').classList.add('hidden'); });
$('#drop').addEventListener('click', function () { $('#upFile').click(); });
['dragenter', 'dragover'].forEach(function (ev) { $('#drop').addEventListener(ev, function (e) { e.preventDefault(); this.classList.add('over'); }); });
['dragleave', 'drop'].forEach(function (ev) { $('#drop').addEventListener(ev, function (e) { e.preventDefault(); this.classList.remove('over'); }); });
$('#drop').addEventListener('drop', function (e) { var fs = e.dataTransfer && e.dataTransfer.files; if (fs && fs.length) handleUploadFiles(fs); });
$('#upFile').addEventListener('change', function () { if (this.files.length) handleUploadFiles(this.files); });

async function handleUploadFiles(fileList) {
  var readId = ++UP_READ_ID;
  UP = null;
  var files = Array.prototype.slice.call(fileList);
  $('#upErr').textContent = ''; $('#pv').classList.add('hidden'); $('#upSave').classList.add('hidden');
  $('#upSourceBrW').classList.add('hidden');
  try {
    var allGroups = Object.create(null), allNames = Object.create(null), fileNames = [], sNote = '', totalRows = 0;
    if (files.some(function (f) { return f.size > 100 * 1024 * 1024; })) throw new Error('ไฟล์ใหญ่เกิน 100 MB กรุณาแบ่งไฟล์ก่อนนำเข้า');
    if (typeof XLSX === 'undefined') throw new Error('ยังโหลดตัวอ่านไฟล์ Excel ไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อและลองใหม่');
    var upDateIso = $('#upDate').value || todayIso();
    /* วันที่ข้อมูลล่าสุด: อ่านจากชื่อไฟล์ เช่น PStkall_691017.xls -> 17/10/2569 (ปีปี เดือน วัน แบบ พ.ศ.) */
    var fnIso = ''; for (var fi = 0; fi < files.length && !fnIso; fi++) fnIso = dateFromFileName(files[fi].name);
    if (fnIso) { upDateIso = fnIso; $('#upDate').value = fnIso; }
    var defG = $('#upDefGrp').value.trim() || '34';
    var defN = $('#upDefName').value.trim();

    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      fileNames.push(f.name);
      var buf = await f.arrayBuffer();
      if (readId !== UP_READ_ID) return;
      var wb = XLSX.read(buf, { type: 'array', dense: true, cellStyles: false, cellFormula: false, cellHTML: false });
      buf = null;
      var sheets = wb.SheetNames.map(function (n) {
        var g = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null });
        delete wb.Sheets[n];
        return { name: n, grid: g };
      });
      var parsed = parseMarketWorkbook(sheets, defG, defN, upDateIso);
      Object.assign(allNames, parsed.names);
      if (parsed.surveyNote) sNote = parsed.surveyNote;
      totalRows += parsed.totalRead;
      Object.keys(parsed.groups).forEach(function (g) {
        if (allGroups[g]) allGroups[g].items = allGroups[g].items.concat(parsed.groups[g].items);
        else allGroups[g] = parsed.groups[g];
      });
    }
    var gKeys = Object.keys(allGroups).sort();
    if (!gKeys.length) throw new Error('ไม่พบตารางสินค้าในไฟล์ — ตรวจสอบว่าไฟล์มีคอลัมน์ รหัส, ชื่อสินค้า, ต้นทุน, ราคาขาย');

    var sources = uploadSourceBranches(allGroups);
    UP = { allGroups: allGroups, groups: Object.create(null), sources: sources, names: allNames, files: fileNames, surveyNote: sNote, repDate: upDateIso, totalRows: 0, totalRead: totalRows };
    $('#upSourceBr').innerHTML = '<option value="__choose__">เลือกสาขาที่ตรงกับปลายทาง…</option>' + sources.map(function (s) {
      return '<option value="' + esc(s.key) + '">' + esc(s.name || 'ไม่ระบุสาขาในไฟล์') + ' (' + nf0.format(s.count) + ' รายการ)</option>';
    }).join('');
    var matchingSource = sources.filter(function (s) { return s.key === brKey(uploadDestinationName()); })[0];
    $('#upSourceBr').value = matchingSource ? matchingSource.key : (sources.length === 1 ? sources[0].key : '__choose__');
    $('#upSourceBrW').classList.toggle('hidden', sources.length === 1 && !sources[0].name);
    selectUploadDestination();
    renderUploadPreview();
  } catch (e) {
    if (readId !== UP_READ_ID) return;
    $('#upErr').textContent = e.message;
  }
}

$('#upSave').addEventListener('click', function () {
  if (!UP) return;
  renderUploadPreview();
  var upload = Object.assign({}, UP), brName = uploadDestinationName();
  if (!Object.keys(upload.groups).length) { toast('ไม่พบข้อมูลของสาขาที่เลือก', true); return; }
  var source = upload.sources.filter(function (s) { return s.key === upload.sourceKey; })[0];
  if (source && source.name && brKey(source.name) !== brKey(brName)) { toast('กรุณาเลือกสาขาปลายทางให้ตรงกับสาขาในไฟล์', true); return; }
  busy(this, async function () {
    if (!brName) { toast('กรุณาเลือกสาขา หรือกรอกชื่อสาขาใหม่', true); return; }
    brName = findBranch(brName) || brName;
    ensureBranch(brName);
    setBranch(brName);
    Object.keys(upload.groups).forEach(function (g) { if (upload.names[g]) D.names[g] = upload.names[g]; });
    if (upload.surveyNote) D.surveyNote = upload.surveyNote;
    var ts = Date.now(), gKeys = Object.keys(upload.groups).sort(), chgSum = 0;
    gKeys.forEach(function (g) {
      var grp = upload.groups[g];
      chgSum += mergeUploadedGroup(g, grp.items, upload.files.join(', '), $('#upDate').value || grp.rep, ts, grp.surveyNote);
    });
    F.g = gKeys[0];
    D.ver = 'cur';
    $('#upDlg').classList.add('hidden');
    rebuildItems();
    renderAll();
    var upOk = await syncToServer();
    if (!upOk) return;
    toast('อัปโหลดข้อมูลเรียบร้อย · สาขา ' + brName + ' · ' + gKeys.length + ' หมวด (' + nf0.format(upload.totalRows) + ' รายการ)' + (chgSum ? ' · ตรวจพบการปรับราคาขาย ' + chgSum + ' รายการ' : ''));
  });
});

/* ---------- ตั้งค่าหมวดสินค้า ---------- */
function nmKeepEdits() {
  document.querySelectorAll('#nmGrid input[data-nmk]').forEach(function (inp) {
    D.names[inp.dataset.nmk] = inp.value.trim();
  });
}
function renderNmGrid() {
  $('#nmBrCur').textContent = D.br || '(ยังไม่มีสาขา)';
  $('#nmDelBrBtn').disabled = !D.br;
  var seen = Object.create(null);
  Object.keys(D.names).concat(Object.keys(D.groups)).forEach(function (k) { seen[k] = 1; });
  var ks = Object.keys(seen).sort();
  if (!ks.length) { $('#nmGrid').innerHTML = '<div class="muted">ยังไม่มีหมวดสินค้า</div>'; return; }
  $('#nmGrid').innerHTML = ks.map(function (k) {
    var g = D.groups[k], n = g && g.cur && g.cur.rows ? g.cur.rows.length : 0;
    return '<div style="display:flex;gap:6px;align-items:center;background:#faf7ff;border:1px solid var(--line);border-radius:10px;padding:6px 10px">' +
      '<b style="min-width:42px">' + esc(k) + '</b>' +
      '<input type="text" data-nmk="' + esc(k) + '" value="' + esc(D.names[k] || '') + '" style="flex:1;min-width:0">' +
      '<button type="button" class="btn ghost small" data-delg="' + esc(k) + '" style="color:var(--bad);border-color:var(--bad);flex:none" title="ลบหมวดนี้ (' + n + ' รายการ)">ลบ</button>' +
    '</div>';
  }).join('');
}
function deleteGroup(g) {
  var cnt = D.groups[g] && D.groups[g].cur && D.groups[g].cur.rows ? D.groups[g].cur.rows.length : 0;
  var label = g + (D.names[g] ? ' ' + D.names[g] : '');
  if (!confirm('ลบหมวด ' + label + (cnt ? ' (' + nf0.format(cnt) + ' รายการ ทั้งฉบับปัจจุบันและฉบับก่อนหน้า)' : '') + ' ?\nลบแล้วกู้คืนไม่ได้')) return false;
  delete D.groups[g];
  delete D.names[g];
  if (F.g === g) F.g = '';
  DIRTY = false;
  rebuildItems();
  renderAll();
  syncThen('ลบหมวด ' + label + ' แล้ว');
  return true;
}
$('#nmGrid').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-delg]'); if (!b) return;
  nmKeepEdits();
  if (deleteGroup(b.dataset.delg)) renderNmGrid();
});
$('#bDelGrp').addEventListener('click', function () { if (F.g) deleteGroup(F.g); });
$('#bNames').addEventListener('click', function () {
  renderNmGrid();
  $('#nmDlg').classList.remove('hidden');
});
$('#nmCancel').addEventListener('click', function () { $('#nmDlg').classList.add('hidden'); });
$('#nmAddBtn').addEventListener('click', function () {
  var c = $('#nmNewCode').value.trim().toUpperCase(), n = $('#nmNewName').value.trim();
  if (!D.br) { toast('กรุณาเพิ่มสาขาก่อน', true); return; }
  if (!c) { toast('กรุณากรอกรหัสหมวด', true); return; }
  nmKeepEdits();
  D.names[c] = n || c;
  $('#nmNewCode').value = ''; $('#nmNewName').value = '';
  renderNmGrid();
});
$('#nmAddBrBtn').addEventListener('click', function () {
  var n = $('#nmNewBr').value.replace(/\s+/g, ' ').trim();
  if (!n) { toast('กรุณากรอกชื่อสาขา', true); return; }
  if (findBranch(n)) { toast('มีสาขา ' + findBranch(n) + ' อยู่แล้ว', true); return; }
  nmKeepEdits();
  ensureBranch(n); setBranch(n);
  $('#nmNewBr').value = ''; F.g = ''; F.page = 0;
  rebuildItems(); renderAll(); renderNmGrid();
  syncThen('เพิ่มสาขา ' + n + ' แล้ว');
});
$('#nmDelBrBtn').addEventListener('click', function () {
  if (!D.br) return;
  var b = D.br, n = Object.keys(D.groups).length;
  if (!confirm('ลบสาขา ' + b + (n ? ' พร้อมข้อมูล ' + n + ' หมวด' : '') + ' ?\n(สาขาอื่นไม่ถูกแตะ) ลบแล้วกู้คืนไม่ได้')) return;
  delete D.store[b];
  D.br = ''; setBranch('');
  F.g = ''; F.page = 0; DIRTY = false;
  rebuildItems(); renderAll(); renderNmGrid();
  syncThen('ลบสาขา ' + b + ' แล้ว');
});
$('#nmSave').addEventListener('click', function () {
  document.querySelectorAll('#nmGrid input[data-nmk]').forEach(function (inp) {
    D.names[inp.dataset.nmk] = inp.value.trim();
  });
  $('#nmDlg').classList.add('hidden');
  renderAll();
  syncThen('บันทึกตั้งค่าหมวดแล้ว');
});
$('#bClearAll').addEventListener('click', function () {
  var n = Object.keys(D.groups).length;
  if (!D.br) { toast('ยังไม่มีสาขา', true); return; }
  if (!confirm('ลบข้อมูลเช็คราคาตลาดทุกหมวดของสาขา ' + D.br + (n ? ' (' + n + ' หมวด)' : '') + ' ออกจากระบบ ?\n(สาขาอื่นไม่ถูกแตะ) ลบแล้วกู้คืนไม่ได้')) return;
  Object.keys(D.groups).forEach(function (k) { delete D.groups[k]; });
  Object.keys(D.names).forEach(function (k) { delete D.names[k]; });
  F.g = '';
  DIRTY = false;
  $('#nmDlg').classList.add('hidden');
  rebuildItems();
  renderAll();
  syncThen('ลบข้อมูลทุกหมวดของสาขา ' + D.br + ' แล้ว');
});

/* =============================================================================
 * ตัวสร้างไฟล์ Excel (.xlsx) รูปแบบเหมือนไฟล์ตัวอย่าง 34ผลิตภัณฑ์ดูแลผ้า.xlsx 100%
 * - แถวที่ 1 (บนสุดของหัวตาราง): ซ้าย (A1:F1) = วันที่อัปข้อมูลเข้า · ขวา (G1:S1) = วันที่ส่งออกข้อมูล + ช่วงสำรวจ
 * - แถวที่ 2 (A2:S2): สำรวจราคาท้องตลาดหมวดสินค้า {รหัสหมวด} {ชื่อหมวด}
 * - แถวที่ 3–6: หัวตาราง 4 ชั้น (ข้อมูลในระบบ ไม่รวม Vat / อื่นๆ รวม Vat)
 * - แถวที่ 7..last: ข้อมูล + สูตรคำนวณ (=ROUND(H7-G7,2), =ROUND((H7-G7)/G7,4), =ROUND(G7*1.07,2), =H7-K7, =ROUND(((H7-K7)/K7),4), =ROUND((G7*1.07*1.3),2))
 * - Conditional Formatting ไฮไลต์สี คงที่ (เหลือง) / ปรับขึ้น (ชมพูแดง) / ปรับลง (ม่วง) / ฝากพิจารณา (เขียวอ่อน) / สินค้าไม่เคลื่อนไหว (เทา)
 * - ท้ายตาราง: สูตร COUNTIF, AVERAGEIF, SUBTOTAL, ตารางกำไรเฉลี่ย, กล่องสรุปการสำรวจ และช่องลงชื่อ 3 ตำแหน่ง
 * ============================================================================= */
var XL_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
var XL_RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
var XL_COLS_XML = '<cols><col min="1" max="1" width="4.796875" customWidth="1"/><col min="2" max="2" width="12.69921875" style="55" customWidth="1"/><col min="3" max="3" width="17.5" customWidth="1"/><col min="4" max="4" width="5.796875" customWidth="1"/><col min="5" max="5" width="8.796875" customWidth="1"/><col min="6" max="6" width="8.5" style="73" customWidth="1"/><col min="7" max="8" width="6.69921875" customWidth="1"/><col min="9" max="9" width="6.19921875" customWidth="1"/><col min="10" max="10" width="5.796875" customWidth="1"/><col min="11" max="11" width="6.69921875" customWidth="1"/><col min="12" max="12" width="6" customWidth="1"/><col min="13" max="13" width="6" bestFit="1" customWidth="1"/><col min="14" max="14" width="6.69921875" customWidth="1"/><col min="15" max="15" width="6.69921875" style="66" customWidth="1"/><col min="16" max="16" width="6.69921875" style="67" customWidth="1"/><col min="17" max="17" width="7.8984375" customWidth="1"/><col min="18" max="18" width="5.5" customWidth="1"/><col min="19" max="19" width="4.796875" customWidth="1"/><col min="20" max="20" width="3.69921875" customWidth="1"/></cols>';

function xlEsc(s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function xlCol(i) { return String.fromCharCode(65 + i); }
function xlSerial(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + 25569 : null;
}

function projectionSummaryFormula(last, vat) {
  var col = vat ? 'V' : 'U';
  return 'IFERROR(AVERAGEIFS(' + col + '7:' + col + last + ',D7:D' + last + ',">0",G7:G' + last + ',">0",K7:K' + last + ',">0"),"")';
}

function xlMarketSheet(sh, ctx, idx) {
  var items = sh.items, n = items.length, last = 6 + Math.max(n, 1), rows = [];
  var sst = function (t) {
    t = String(t == null ? '' : t);
    var k = ctx.sst[t];
    if (k === undefined) { k = ctx.sstList.length; ctx.sst[t] = k; ctx.sstList.push(t); }
    return k;
  };
  var S = function (ref, s, t) { return '<c r="' + ref + '" s="' + s + '" t="s"><v>' + sst(t) + '</v></c>'; };
  var N = function (ref, s, v) { return (v === null || v === undefined || v === '' || !isFinite(Number(v))) ? '<c r="' + ref + '" s="' + s + '"/>' : '<c r="' + ref + '" s="' + s + '"><v>' + Number(v) + '</v></c>'; };
  var F = function (ref, s, fml, v) {
    var valTag = (v !== null && v !== undefined && isFinite(Number(v))) ? '<v>' + Number(v) + '</v>' : '';
    return '<c r="' + ref + '" s="' + s + '"><f>' + fml + '</f>' + valTag + '</c>';
  };
  var E = function (ref, s) { return '<c r="' + ref + '" s="' + s + '"/>'; };
  var pushRow = function (r, cells, ht) {
    rows.push('<row r="' + r + '" spans="1:22"' + (ht ? ' ht="' + ht + '" customHeight="1"' : '') + '>' + cells.join('') + '</row>');
  };

  /* Row 1: บนสุดของหัวตาราง = วันที่อัปข้อมูลเข้า (A1:F1) กับ วันที่ส่งออกข้อมูล (G1:S1) */
  var r1 = [
    S('A1', 76, sh.leftHead), E('B1', 76), E('C1', 76), E('D1', 76), E('E1', 76), E('F1', 76),
    S('G1', 77, sh.rightHead)
  ];
  for (var c1 = 7; c1 < 19; c1++) r1.push(E(xlCol(c1) + '1', 77));
  pushRow(1, r1, 18.6);

  /* Row 2: ชื่อรายงานหมวดสินค้า (A2:S2) */
  var r2Styles = [78,79,79,79,79,80,79,79,79,79,79,79,79,79,81,81,79,79,82];
  var r2 = r2Styles.map(function (st, c) { return c === 0 ? S('A2', st, sh.title) : E(xlCol(c) + '2', st); });
  pushRow(2, r2, 18);

  /* Row 3–6: หัวตาราง 4 ชั้นตามไฟล์ตัวอย่าง 34ผลิตภัณฑ์ดูแลผ้า.xlsx */
  pushRow(3, [
    S('A3', 83, 'ลำดับ'), S('B3', 86, 'รหัส'), S('C3', 83, 'ชื่อสินค้า'),
    S('D3', 89, 'ข้อมูลในระบบ (ไม่รวม Vat)'), E('E3', 90), E('F3', 91), E('G3', 90), E('H3', 90), E('I3', 90), E('J3', 92),
    S('K3', 78, 'อื่นๆ (รวม Vat)'), E('L3', 79), E('M3', 79), E('N3', 79), E('O3', 81), E('P3', 81), E('Q3', 79), E('R3', 79), E('S3', 82),
    S('T3', 83, 'ผลหลังใช้ราคาแนะนำ'), E('U3', 83), E('V3', 83)
  ], 17.4);

  pushRow(4, [
    E('A4', 84), E('B4', 87), E('C4', 84),
    S('D4', 83, 'จำนวนคงเหลือสินค้า'), S('E4', 74, 'ปรับครั้งล่าสุด'), E('F4', 75),
    S('G4', 93, 'ต้นทุน'), S('H4', 93, 'ราคาขาย'), S('I4', 93, 'กำไร'), S('J4', 83, 'กำไร%'),
    S('K4', 103, 'ต้นทุน+Vat'), S('L4', 93, 'กำไร'), S('M4', 83, 'กำไร%'), S('N4', 100, 'ราคาขาย ถ้ากำไร 30%'),
    S('O4', 74, 'ราคาท้องตลาด'), E('P4', 74), S('Q4', 96, 'รายการแนะนำ'), E('R4', 97), S('S4', 83, 'แก้ไข'),
    S('T4', 83, 'ราคาหลังปรับ'), S('U4', 83, 'กำไร% ไม่รวม Vat'), S('V4', 83, 'กำไร% รวม Vat')
  ], 16.8);

  pushRow(5, [
    E('A5', 84), E('B5', 87), E('C5', 84), E('D5', 84), E('E5', 74), E('F5', 75),
    E('G5', 94), E('H5', 94), E('I5', 94), E('J5', 84), E('K5', 104), E('L5', 94), E('M5', 84), E('N5', 101),
    E('O5', 74), E('P5', 74), E('Q5', 98), E('R5', 99), E('S5', 84), E('T5', 84), E('U5', 84), E('V5', 84)
  ], 16.8);

  pushRow(6, [
    E('A6', 85), E('B6', 88), E('C6', 85), E('D6', 85), E('E6', 3), E('F6', 71),
    E('G6', 95), E('H6', 95), E('I6', 95), E('J6', 85), E('K6', 105), E('L6', 95), E('M6', 85), E('N6', 102),
    S('O6', 3, 'ต่ำสุด'), S('P6', 57, 'สูงสุด'), S('Q6', 3, 'ปรับ'), S('R6', 3, 'ราคา'), E('S6', 85), E('T6', 85), E('U6', 85), E('V6', 85)
  ], 34.2);

  /* Data Rows 7..last */
  items.forEach(function (x, i) {
    var r = 7 + i;
    var codeStr = String(x.code == null ? '' : x.code).trim();
    var codeCell = /^(0|[1-9]\d{0,14})$/.test(codeStr) ? N('B' + r, 5, Number(codeStr)) : S('B' + r, 5, codeStr);
    var update = latestUpdate(x);
    var projected = priceProjection(x);
    var eTxt = update.text ? update.text : '';
    var oCell = (x.mktMin === '' || x.mktMin === null || x.mktMin === undefined)
      ? E('O' + r, 56)
      : (typeof x.mktMin === 'number' && isFinite(x.mktMin) ? N('O' + r, 59, x.mktMin) : S('O' + r, 59, String(x.mktMin)));
    var pCell = (x.mktMax === '' || x.mktMax === null || x.mktMax === undefined)
      ? E('P' + r, 58)
      : (typeof x.mktMax === 'number' && isFinite(x.mktMax) ? N('P' + r, 60, x.mktMax) : S('P' + r, 60, String(x.mktMax)));
    var rCell = (x.recPrice === '' || x.recPrice === null || x.recPrice === undefined)
      ? E('R' + r, 17)
      : (typeof x.recPrice === 'number' && isFinite(x.recPrice) ? N('R' + r, 17, x.recPrice) : S('R' + r, 17, String(x.recPrice)));
    var sCell = x.editNote ? (isFinite(Number(x.editNote)) ? N('S' + r, 18, Number(x.editNote)) : S('S' + r, 18, x.editNote)) : E('S' + r, 18);

    pushRow(r, [
      N('A' + r, 4, i + 1),
      codeCell,
      S('C' + r, 6, x.name),
      N('D' + r, 7, x.qty),
      eTxt ? S('E' + r, 8, eTxt) : E('E' + r, 8),
      E('F' + r, 9),
      N('G' + r, 10, x.cost),
      N('H' + r, 11, x.price),
      F('I' + r, 12, 'ROUND(H' + r + '-G' + r + ',2)', x.profitEx),
      F('J' + r, 13, 'IFERROR(ROUND((H' + r + '-G' + r + ')/G' + r + ',4),0)', x.marginEx),
      F('K' + r, 14, 'ROUND(G' + r + '*1.07,2)', x.costVat),
      F('L' + r, 15, 'H' + r + '-K' + r, x.profitInc),
      F('M' + r, 13, 'IFERROR(ROUND(((H' + r + '-K' + r + ')/K' + r + '),4),0)', x.marginInc),
      F('N' + r, 16, 'ROUND((G' + r + '*1.07*1.3),2)', x.price30),
      oCell,
      pCell,
      S('Q' + r, 17, x.recAct || (x.qty <= 0 ? 'สินค้าไม่เคลื่อนไหว' : 'คงที่')),
      rCell,
      sCell,
      F('T' + r, 11, 'IF(AND(OR(Q' + r + '="ปรับขึ้น",Q' + r + '="ปรับลง",Q' + r + '="ฝากพิจารณา"),ISNUMBER(R' + r + '),R' + r + '>0,IFERROR(ABS(R' + r + '-H' + r + '),0)>=0.005),R' + r + ',H' + r + ')', projected.price),
      F('U' + r, 13, 'IF(AND(G' + r + '>0,K' + r + '>0),ROUND((T' + r + '-G' + r + ')/G' + r + ',4),"")', x.cost > 0 && x.costVat > 0 ? projected.marginEx : null),
      F('V' + r, 13, 'IF(AND(G' + r + '>0,K' + r + '>0),ROUND((T' + r + '-K' + r + ')/K' + r + ',4),"")', x.cost > 0 && x.costVat > 0 ? projected.marginInc : null)
    ], 37.2);
  });

  /* แถวสรุปท้ายตาราง (เหมือน Row 346..355 ในไฟล์ตัวอย่าง) */
  var activeItems = items.filter(function (x) { return x.qty > 0; });
  var projection = summarizePriceProjection(items);
  var avgEx = projection.avgBeforeEx, avgInc = projection.avgBeforeInc;

  var rAvg = last + 1;     // Row 346
  var rBlank1 = last + 2;  // Row 347
  var rSumHd = last + 3;   // Row 348
  var rSum1 = last + 4;    // Row 349
  var rSum2 = last + 5;    // Row 350
  var rSum3 = last + 6;    // Row 351
  var rSum4 = last + 7;    // Row 352
  var rBlank2 = last + 8;  // Row 353
  var rSig1 = last + 9;    // Row 354
  var rSig2 = last + 10;   // Row 355

  pushRow(rAvg, [
    E('A' + rAvg, 25), E('B' + rAvg, 26), E('C' + rAvg, 27),
    F('D' + rAvg, 28, 'COUNTIF(D7:D' + last + ',">0")', activeItems.length),
    E('E' + rAvg, 29), E('F' + rAvg, 30), E('G' + rAvg, 31), E('H' + rAvg, 31), E('I' + rAvg, 31),
    F('J' + rAvg, 32, 'IFERROR(AVERAGEIFS(J7:J' + last + ',D7:D' + last + ',">0",G7:G' + last + ',">0",K7:K' + last + ',">0"),"")', avgEx),
    E('K' + rAvg, 33), E('L' + rAvg, 33),
    F('M' + rAvg, 32, 'IFERROR(AVERAGEIFS(M7:M' + last + ',D7:D' + last + ',">0",G7:G' + last + ',">0",K7:K' + last + ',">0"),"")', avgInc),
    E('N' + rAvg, 34), E('O' + rAvg, 61), E('P' + rAvg, 62), E('Q' + rAvg, 35), E('R' + rAvg, 35), E('S' + rAvg, 36)
  ], 18.6);

  pushRow(rBlank1, [
    E('A' + rBlank1, 25), E('B' + rBlank1, 26), E('C' + rBlank1, 27), E('D' + rBlank1, 35), E('E' + rBlank1, 29), E('F' + rBlank1, 30),
    E('G' + rBlank1, 31), E('H' + rBlank1, 31), E('I' + rBlank1, 31), E('J' + rBlank1, 32), E('K' + rBlank1, 33), E('L' + rBlank1, 33),
    E('M' + rBlank1, 32), E('N' + rBlank1, 34), E('O' + rBlank1, 61), E('P' + rBlank1, 62), E('Q' + rBlank1, 35), E('R' + rBlank1, 35), E('S' + rBlank1, 36)
  ], 18.6);

  pushRow(rSumHd, [
    F('A' + rSumHd, 25, 'COUNTIF(D7:D' + last + ',">0")', activeItems.length),
    E('B' + rSumHd, 26), S('C' + rSumHd, 110, 'กำไรเฉลี่ยของสินค้าที่มีอยู่'), E('D' + rSumHd, 111), E('E' + rSumHd, 29),
    S('F' + rSumHd, 112, sh.sumTitle),
    E('G' + rSumHd, 113), E('H' + rSumHd, 113), E('I' + rSumHd, 113), E('J' + rSumHd, 113), E('K' + rSumHd, 113), E('L' + rSumHd, 113),
    E('M' + rSumHd, 113), E('N' + rSumHd, 113), E('O' + rSumHd, 113), E('P' + rSumHd, 113), E('Q' + rSumHd, 113), E('R' + rSumHd, 114), E('S' + rSumHd, 36)
  ], 18.6);

  pushRow(rSum1, [
    E('A' + rSum1, 37), E('B' + rSum1, 38), S('C' + rSum1, 39, 'กำไรเฉลี่ยหักเดิม'), F('D' + rSum1, 40, 'J' + rAvg, avgEx), E('E' + rSum1, 37),
    S('F' + rSum1, 119, sh.sumText),
    E('G' + rSum1, 119), E('H' + rSum1, 119), E('I' + rSum1, 119), E('J' + rSum1, 119), E('K' + rSum1, 119), E('L' + rSum1, 119),
    E('M' + rSum1, 119), E('N' + rSum1, 119), E('O' + rSum1, 119), E('P' + rSum1, 119), E('Q' + rSum1, 119), E('R' + rSum1, 119), E('S' + rSum1, 37)
  ], 44);

  pushRow(rSum2, [
    E('A' + rSum2, 37), E('B' + rSum2, 38), S('C' + rSum2, 39, 'กำไรเฉลี่ยหัก Vat แล้ว'), F('D' + rSum2, 41, 'M' + rAvg, avgInc), E('E' + rSum2, 37),
    E('F' + rSum2, 119), E('G' + rSum2, 119), E('H' + rSum2, 119), E('I' + rSum2, 119), E('J' + rSum2, 119), E('K' + rSum2, 119), E('L' + rSum2, 119),
    E('M' + rSum2, 119), E('N' + rSum2, 119), E('O' + rSum2, 119), E('P' + rSum2, 119), E('Q' + rSum2, 119), E('R' + rSum2, 119), E('S' + rSum2, 37)
  ], 44);

  [rSum3, rSum4].forEach(function (rr, idx) {
    pushRow(rr, [
      E('A' + rr, 42), E('B' + rr, 35), S('C' + rr, 39, idx ? 'หลังปรับ (รวม Vat)' : 'หลังปรับ (ไม่รวม Vat)'),
      F('D' + rr, 41, projectionSummaryFormula(last, !!idx), idx ? projection.avgAfterInc : projection.avgAfterEx), E('E' + rr, 29),
      E('F' + rr, 119), E('G' + rr, 119), E('H' + rr, 119), E('I' + rr, 119), E('J' + rr, 119), E('K' + rr, 119), E('L' + rr, 119),
      E('M' + rr, 119), E('N' + rr, 119), E('O' + rr, 119), E('P' + rr, 119), E('Q' + rr, 119), E('R' + rr, 119), E('S' + rr, 36)
    ], 44);
  });

  pushRow(rBlank2, [
    E('A' + rBlank2, 37), E('B' + rBlank2, 38), E('C' + rBlank2, 37), E('D' + rBlank2, 37), E('E' + rBlank2, 37), E('F' + rBlank2, 72),
    E('G' + rBlank2, 37), E('H' + rBlank2, 37), E('I' + rBlank2, 37), E('J' + rBlank2, 37), E('K' + rBlank2, 37), E('L' + rBlank2, 37),
    E('M' + rBlank2, 37), E('N' + rBlank2, 37), E('O' + rBlank2, 63), E('P' + rBlank2, 64), E('Q' + rBlank2, 37), E('R' + rBlank2, 37), E('S' + rBlank2, 37)
  ], 18.6);

  pushRow(rSig1, [
    E('A' + rSig1, 43), E('B' + rSig1, 44), E('C' + rSig1, 68), E('D' + rSig1, 36),
    S('E' + rSig1, 115, 'ลงชื่อ' + (sh.surveyor ? '            ' + sh.surveyor : '')), E('F' + rSig1, 116), E('G' + rSig1, 115), E('H' + rSig1, 45),
    S('I' + rSig1, 117, 'ลงชื่อ' + (sh.checker ? '            ' + sh.checker : '')), E('J' + rSig1, 117), E('K' + rSig1, 117), E('L' + rSig1, 33),
    S('M' + rSig1, 115, 'ลงชื่อ' + (sh.approver ? '            ' + sh.approver : '')), E('N' + rSig1, 115), E('O' + rSig1, 118), E('P' + rSig1, 118),
    E('Q' + rSig1, 46), E('R' + rSig1, 46), E('S' + rSig1, 37)
  ], 18.6);

  pushRow(rSig2, [
    E('A' + rSig2, 43), E('B' + rSig2, 44), E('C' + rSig2, 69), E('D' + rSig2, 47),
    S('E' + rSig2, 106, 'ผู้สำรวจราคาตลาด'), E('F' + rSig2, 107), E('G' + rSig2, 106), E('H' + rSig2, 48),
    S('I' + rSig2, 108, 'ผู้ตรวจสอบความถูกต้อง'), E('J' + rSig2, 108), E('K' + rSig2, 108), E('L' + rSig2, 49),
    S('M' + rSig2, 108, 'ผู้ปรับแก้ไขราคาสินค้า'), E('N' + rSig2, 108), E('O' + rSig2, 109), E('P' + rSig2, 109),
    E('Q' + rSig2, 47), E('R' + rSig2, 47), E('S' + rSig2, 37)
  ], 18.6);

  var merges = [
    'A1:F1', 'G1:S1', 'A2:S2',
    'A3:A6', 'B3:B6', 'C3:C6', 'D3:J3', 'K3:S3',
    'D4:D6', 'E4:F6', 'G4:G6', 'H4:H6', 'I4:I6', 'J4:J6',
    'K4:K6', 'L4:L6', 'M4:M6', 'N4:N6', 'O4:P5', 'Q4:R5', 'S4:S6',
    'T3:V3', 'T4:T6', 'U4:U6', 'V4:V6',
    'C' + rSumHd + ':D' + rSumHd, 'F' + rSumHd + ':R' + rSumHd,
    'F' + rSum1 + ':R' + rSum4,
    'E' + rSig1 + ':G' + rSig1, 'I' + rSig1 + ':K' + rSig1, 'M' + rSig1 + ':P' + rSig1,
    'E' + rSig2 + ':G' + rSig2, 'I' + rSig2 + ':K' + rSig2, 'M' + rSig2 + ':P' + rSig2
  ];

  for (var mr = 7; mr <= last; mr++) merges.push('E' + mr + ':F' + mr);
  var cfXml =
    '<conditionalFormatting sqref="O7:O' + last + '"><cfRule type="expression" dxfId="7" priority="1"><formula>$O7="-"</formula></cfRule></conditionalFormatting>' +
    '<conditionalFormatting sqref="O7:R' + last + '"><cfRule type="expression" dxfId="6" priority="6"><formula>$Q7="สินค้าไม่เคลื่อนไหว"</formula></cfRule></conditionalFormatting>' +
    '<conditionalFormatting sqref="P7:P' + last + '"><cfRule type="expression" dxfId="5" priority="5"><formula>$P7="-"</formula></cfRule></conditionalFormatting>' +
    '<conditionalFormatting sqref="Q7:R' + last + '">' +
      '<cfRule type="expression" dxfId="4" priority="2"><formula>$Q7="ฝากพิจารณา"</formula></cfRule>' +
      '<cfRule type="expression" dxfId="3" priority="7"><formula>$Q7="คงที่"</formula></cfRule>' +
      '<cfRule type="expression" dxfId="2" priority="8"><formula>$Q7="ปรับขึ้น"</formula></cfRule>' +
      '<cfRule type="expression" dxfId="1" priority="9"><formula>$Q7="ปรับลง"</formula></cfRule>' +
    '</conditionalFormatting>' +
    '<conditionalFormatting sqref="R7:R' + last + '"><cfRule type="expression" dxfId="0" priority="4"><formula>$R7="-"</formula></cfRule></conditionalFormatting>';

  var dvXml = '<dataValidations count="1"><dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="Q7:Q' + last + '"><formula1>"คงที่,ปรับขึ้น,ปรับลง,สินค้าไม่เคลื่อนไหว,ฝากพิจารณา"</formula1></dataValidation></dataValidations>';

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="' + XL_NS + '" xmlns:r="' + XL_RNS + '">' +
    '<sheetPr filterMode="1"><pageSetUpPr fitToPage="1"/></sheetPr>' +
    '<dimension ref="A1:V' + rSig2 + '"/>' +
    '<sheetViews><sheetView' + (idx === 0 ? ' tabSelected="1"' : '') + ' zoomScale="115" zoomScaleNormal="115" workbookViewId="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultColWidth="5.69921875" defaultRowHeight="16.8"/>' +
    XL_COLS_XML.replace('<col min="20" max="20" width="3.69921875" customWidth="1"/>', '<col min="20" max="20" width="12" customWidth="1"/><col min="21" max="22" width="13" customWidth="1"/>') +
    '<sheetData>' + rows.join('') + '</sheetData>' +
    '<mergeCells count="' + merges.length + '">' + merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>' +
    cfXml + dvXml +
    '<pageMargins left="0.23622047244094491" right="0.23622047244094491" top="0" bottom="0" header="0.31496062992125984" footer="0.31496062992125984"/>' +
    '<pageSetup paperSize="9" scale="89" fitToHeight="0" orientation="landscape"/>' +
    '</worksheet>';
}

/* ---- ตัวบีบอัด ZIP สำหรับไฟล์ .xlsx ---- */
var XL_CRCT = null;
function xlCrc(u8) {
  if (!XL_CRCT) {
    XL_CRCT = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      XL_CRCT[n] = c >>> 0;
    }
  }
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < u8.length; i++) crc = XL_CRCT[(crc ^ u8[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
async function xlDeflate(u8) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    var cs = new CompressionStream('deflate-raw'), w = cs.writable.getWriter();
    w.write(u8); w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  } catch (e) { return null; }
}
async function xlZip(files) {
  var enc = new TextEncoder(), now = new Date();
  var dtime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  var ddate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  var out = [], cen = [], off = 0;
  for (var i = 0; i < files.length; i++) {
    var f = files[i], raw = enc.encode(f.data), name = enc.encode(f.name), crc = xlCrc(raw);
    var comp = await xlDeflate(raw), body = comp || raw, method = comp ? 8 : 0;
    var lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
    lh.setUint16(10, dtime, true); lh.setUint16(12, ddate, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, body.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    var ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true); ch.setUint16(12, dtime, true); ch.setUint16(14, ddate, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, body.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    out.push(new Uint8Array(lh.buffer), name, body);
    cen.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + body.length;
  }
  var csize = cen.reduce(function (s, p) { return s + p.length; }, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, off, true);
  var all = out.concat(cen, [new Uint8Array(end.buffer)]), total = all.reduce(function (s, p) { return s + p.length; }, 0);
  var buf = new Uint8Array(total), pos = 0;
  all.forEach(function (p) { buf.set(p, pos); pos += p.length; });
  return buf;
}

async function xlsxBuildMarket(sheets) {
  var ctx = { sst: Object.create(null), sstList: [] }, files = [], N = sheets.length, ct = '', wbSheets = '', wbRels = '', printAreas = '';
  var REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  sheets.forEach(function (sh, i) {
    files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: xlMarketSheet(sh, ctx, i) });
    ct += '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    wbSheets += '<sheet name="' + xlEsc(sh.name.slice(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
    printAreas += '<definedName name="_xlnm.Print_Area" localSheetId="' + i + '">' + xlEsc("'" + sh.name.slice(0, 31).replace(/'/g, "''") + "'!$A$1:$S$" + (16 + Math.max(sh.items.length, 1))) + '</definedName>';
    wbRels += '<Relationship Id="rId' + (i + 1) + '" Type="' + REL + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
  });
  wbRels += '<Relationship Id="rId' + (N + 1) + '" Type="' + REL + '/styles" Target="styles.xml"/>' +
            '<Relationship Id="rId' + (N + 2) + '" Type="' + REL + '/sharedStrings" Target="sharedStrings.xml"/>' +
            '<Relationship Id="rId' + (N + 3) + '" Type="' + REL + '/theme" Target="theme/theme1.xml"/>';
  files.unshift(
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + ct + '<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' + XL_NS + '" xmlns:r="' + XL_RNS + '"><bookViews><workbookView/></bookViews><sheets>' + wbSheets + '</sheets><definedNames>' + printAreas + '</definedNames></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + wbRels + '</Relationships>' },
    { name: 'xl/theme/theme1.xml', data: THEME1_XML },
    { name: 'xl/styles.xml', data: STYLES_XML }
  );
  files.push({
    name: 'xl/sharedStrings.xml',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="' + XL_NS + '" count="' + ctx.sstList.length + '" uniqueCount="' + ctx.sstList.length + '">' +
      ctx.sstList.map(function (t) { return '<si><t xml:space="preserve">' + xlEsc(t) + '</t></si>'; }).join('') + '</sst>'
  });
  return xlZip(files);
}

/* ---------- เปิดหน้าต่างส่งออก Excel ---------- */
function refreshExHeaders() {
  var useBe = $('#exYearMode').value === 'be';
  var m = curGroupMeta(F.g);
  var upDate = fmtDateSlash((m && (m.rep || m.ts)) || Date.now(), useBe);
  var exDate = fmtDateSlash(Date.now(), useBe);
  var sNote = stripOldNote((m && m.surveyNote) || D.surveyNote || '');
  $('#exLeftHead').value = 'อัปข้อมูลเข้า วันที่ ' + upDate;
  $('#exRightHead').value = 'ส่งออกข้อมูล วันที่ ' + exDate + (sNote ? ' · ' + sNote : '');
}

$('#bXlsx').addEventListener('click', function () {
  if (!D.items.length) { toast('ไม่มีรายการให้ส่งออก', true); return; }
  var m = curGroupMeta(F.g);
  refreshExHeaders();
  var flt = filteredItems();
  var gSet = Object.create(null); flt.forEach(function (x) { gSet[x.g] = 1; });
  $('#exN1').textContent = nf0.format(flt.length) + ' รายการ · ' + Object.keys(gSet).length + ' หมวด';
  $('#exN2').textContent = nf0.format(D.items.length) + ' รายการ · ' + D.allGroups.length + ' หมวด';
  $('#exErr').textContent = '';
  $('#exDlg').classList.remove('hidden');
});
$('#exYearMode').addEventListener('change', refreshExHeaders);
$('#exCancel').addEventListener('click', function () { $('#exDlg').classList.add('hidden'); });

$('#exGo').addEventListener('click', function () {
  var selMode = document.querySelector('input[name=exMode]:checked'), mode = selMode ? selMode.value : 'filter';
  var list = mode === 'all' ? D.items : filteredItems();
  if (!list.length) { $('#exErr').textContent = 'ไม่มีรายการให้ส่งออก'; return; }
  busy(this, async function () {
    var byG = Object.create(null);
    list.forEach(function (x) { (byG[x.g] || (byG[x.g] = [])).push(x); });
    var useBe = $('#exYearMode').value === 'be';
    var customLeft = $('#exLeftHead').value.trim();
    var customRight = $('#exRightHead').value.trim();

    var sheets = Object.keys(byG).sort().map(function (g) {
      var gItems = byG[g], gName = (D.names && D.names[g]) || '';
      var gm = curGroupMeta(g);
      var upDate = fmtDateSlash((gm && (gm.rep || gm.ts)) || Date.now(), useBe);
      var leftH = Object.keys(byG).length === 1 && customLeft ? customLeft : ('อัปข้อมูลเข้า วันที่ ' + upDate);
      var rightH = customRight || ('ส่งออกข้อมูล วันที่ ' + fmtDateSlash(Date.now(), useBe));

      var act = gItems.filter(function (x) { return x.qty > 0; });
      var inactCnt = gItems.length - act.length;
      var upCnt = gItems.filter(function (x) { return x.recAct === 'ปรับขึ้น'; }).length;
      var downCnt = gItems.filter(function (x) { return x.recAct === 'ปรับลง'; }).length;
      var consCnt = gItems.filter(function (x) { return x.recAct === 'ฝากพิจารณา'; }).length;
      var adjTot = upCnt + downCnt + consCnt;
      var projection = summarizePriceProjection(gItems);
      var avgEx = projection.avgBeforeEx, avgInc = projection.avgBeforeInc;

      return {
        name: g,
        leftHead: leftH,
        rightHead: rightH,
        title: 'สำรวจราคาท้องตลาดหมวดสินค้า ' + g + (gName ? ' ' + gName : '') + (D.br ? ' · สาขา ' + D.br : ''),
        sumTitle: 'สรุปการสำรวจ หมวด ' + g + (gName ? ' ' + gName : ''),
        sumText: buildSummaryText(g, gName, gItems.length, inactCnt, act.length, adjTot, upCnt, downCnt, consCnt, avgEx, avgInc, projection),
        surveyor: D.surveyor || '',
        checker: D.checker || '',
        approver: D.approver || '',
        items: gItems
      };
    });

    var u8 = await xlsxBuildMarket(sheets);
    var firstG = sheets[0].name, firstName = (D.names && D.names[firstG]) || '';
    var brPre = D.br ? D.br.replace(/[\\/:*?"<>|]/g, '') + '_' : '';
    var fn = sheets.length === 1
      ? (brPre + firstG + (firstName ? firstName : '_สำรวจราคาตลาด') + '.xlsx')
      : (brPre + 'สำรวจราคาตลาด_' + todayIso() + '.xlsx');
    var a = document.createElement('a'), url = URL.createObjectURL(new Blob([u8], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.href = url; a.download = fn; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    $('#exDlg').classList.add('hidden');
    toast('ดาวน์โหลดไฟล์ ' + fn + ' เรียบร้อยแล้ว');
  });
});

initToken();
load();
