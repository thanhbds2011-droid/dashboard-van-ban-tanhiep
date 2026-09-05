/**
 * Native DOCX exporter for KPI administrative forms.
 * Creates a real Office Open XML document without external conversion services.
 */
const encoder = new TextEncoder();

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
function u16(v){const a=new Uint8Array(2);new DataView(a.buffer).setUint16(0,v,true);return a;}
function u32(v){const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,v>>>0,true);return a;}
function concat(parts){const n=parts.reduce((s,p)=>s+p.length,0),o=new Uint8Array(n);let x=0;for(const p of parts){o.set(p,x);x+=p.length;}return o;}
const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[i]=c>>>0;}return t;})();
function crc32(bytes){let c=0xFFFFFFFF;for(const b of bytes)c=CRC_TABLE[(c^b)&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
function dosDateTime(d=new Date()){const y=Math.max(1980,d.getFullYear());return{time:(d.getHours()<<11)|(d.getMinutes()<<5)|Math.floor(d.getSeconds()/2),date:((y-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate()};}
function zipStore(files){const local=[],central=[],stamp=dosDateTime();let offset=0;for(const f of files){const name=encoder.encode(f.name),data=typeof f.content==='string'?encoder.encode(f.content):f.content,crc=crc32(data);const lh=concat([u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(stamp.time),u16(stamp.date),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name]);local.push(lh,data);const ch=concat([u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(stamp.time),u16(stamp.date),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]);central.push(ch);offset+=lh.length+data.length;}const l=concat(local),c=concat(central),end=concat([u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(c.length),u32(l.length),u16(0)]);return concat([l,c,end]);}

function safeFileName(v){return String(v||'Bao_cao_KPI.docx').replace(/[\\/:*?"<>|]+/g,'_').replace(/\s+/g,'_').replace(/_+/g,'_');}
function cleanText(v){return String(v??'').replace(/\u00a0/g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n[ \t]+/g,'\n').replace(/[ \t]{2,}/g,' ').trim();}
function runXml(text,{bold=false,italic=false,size=26}={}){if(!text)return '';const preserve=/^\s|\s$|\n/.test(text)?' xml:space="preserve"':'';const props=[];if(bold)props.push('<w:b/>');if(italic)props.push('<w:i/>');props.push(`<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`,`<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman"/>`);return `<w:r><w:rPr>${props.join('')}</w:rPr><w:t${preserve}>${esc(text)}</w:t></w:r>`;}
function paragraphXml(text,{bold=false,italic=false,center=false,right=false,size=26,after=80,before=0}={}){const align=center?'center':right?'right':'both';const parts=cleanText(text).split(/\n/);const runs=parts.map((part,i)=>`${i?'<w:br/>':''}${runXml(part,{bold,italic,size})}`).join('');return `<w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:before="${before}" w:after="${after}" w:line="300" w:lineRule="auto"/></w:pPr>${runs}</w:p>`;}
function emptyParagraph(){return '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';}
function cellXml(text,{colspan=1,center=false,bold=false}={}){const span=colspan>1?`<w:gridSpan w:val="${colspan}"/>`:'';return `<w:tc><w:tcPr>${span}<w:vAlign w:val="center"/><w:tcMar><w:top w:w="70" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar></w:tcPr>${paragraphXml(text,{center,bold,after:0,size:24})}</w:tc>`;}
function tableXml(table){const rows=[...table.rows];if(!rows.length)return '';let gridCols=0;for(const tr of rows){let n=0;for(const td of tr.cells)n+=Number(td.colSpan||1);gridCols=Math.max(gridCols,n);}const grid=Array.from({length:gridCols},()=>'<w:gridCol w:w="1200"/>').join('');const trs=rows.map((tr,ri)=>{const cells=[...tr.cells].map(td=>cellXml(cleanText(td.innerText||td.textContent||''),{colspan:Number(td.colSpan||1),center:td.classList.contains('m01-center')||ri===0||td.tagName==='TH',bold:td.tagName==='TH'||td.querySelector('strong')!=null||tr.classList.contains('m01-total-row')||tr.classList.contains('m01-grand-total')})).join('');return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells}</w:tr>`;}).join('');return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="autofit"/><w:tblBorders><w:top w:val="single" w:sz="6" w:color="000000"/><w:left w:val="single" w:sz="6" w:color="000000"/><w:bottom w:val="single" w:sz="6" w:color="000000"/><w:right w:val="single" w:sz="6" w:color="000000"/><w:insideH w:val="single" w:sz="6" w:color="000000"/><w:insideV w:val="single" w:sz="6" w:color="000000"/></w:tblBorders><w:tblCellMar><w:top w:w="70" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${trs}</w:tbl>`;}

function elementBlocks(root){const blocks=[];const pushText=(el,opts={})=>{const text=cleanText(el.innerText||el.textContent||'');if(text)blocks.push(paragraphXml(text,opts));};
  const walk=(el)=>{if(!el||el.nodeType!==1)return;if(el.classList?.contains('kpi-no-print')||el.classList?.contains('kpi-hidden'))return;const tag=el.tagName;
    if(tag==='TABLE'){blocks.push(tableXml(el));return;}
    if(/^H[1-6]$/.test(tag)){pushText(el,{bold:true,center:tag==='H1',size:tag==='H1'?30:26,before:80,after:80});return;}
    if(tag==='P'){pushText(el,{after:70});return;}
    if(tag==='BR'){blocks.push(emptyParagraph());return;}
    const cls=el.classList||{contains:()=>false};
    if(cls.contains('m01-agency')||cls.contains('m01-national')||cls.contains('m01-form-number')){pushText(el,{bold:true,center:true,size:24,after:40});return;}
    if(cls.contains('m01-section-title')){pushText(el,{bold:true,size:26,before:90,after:50});return;}
    if(cls.contains('m01-intro')||cls.contains('m01-proposal')||cls.contains('m01-rating-levels')||cls.contains('m01-quality-result')){pushText(el,{after:70});return;}
    if(cls.contains('m01-self-sign')||cls.contains('m01-authority-sign')){pushText(el,{bold:true,center:true,before:120,after:80});return;}
    if(cls.contains('m01-profile')){for(const child of el.children)pushText(child,{after:30});return;}
    const children=[...el.children];if(children.length){for(const child of children)walk(child);return;}
    pushText(el,{after:50});
  };
  for(const child of root.children)walk(child);
  return blocks.join('');
}

export function buildDocxBlobFromElement(root,{title='Báo cáo KPI cá nhân',creator='Trung tâm Bảo trợ xã hội Tân Hiệp'}={}){
  if(!root)throw new Error('Không tìm thấy nội dung biểu mẫu để xuất Word.');
  const body=elementBlocks(root);
  const documentXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1134" w:header="500" w:footer="500" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="300" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
  const rels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const docRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const types=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const now=new Date().toISOString();
  const core=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>${esc(creator)}</dc:creator><cp:lastModifiedBy>Ứng dụng Nhiệm vụ và đánh giá KPI</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const app=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Nhiệm vụ và đánh giá KPI - Tân Hiệp</Application></Properties>`;
  const zip=zipStore([{name:'[Content_Types].xml',content:types},{name:'_rels/.rels',content:rels},{name:'docProps/core.xml',content:core},{name:'docProps/app.xml',content:app},{name:'word/document.xml',content:documentXml},{name:'word/styles.xml',content:styles},{name:'word/_rels/document.xml.rels',content:docRels}]);
  return new Blob([zip],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}

export function exportDomToDocx(root,options={}){
  const blob=buildDocxBlobFromElement(root,options);const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=safeFileName(options.fileName||'Bao_cao_KPI.docx');document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
