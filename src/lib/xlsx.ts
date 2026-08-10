import { zipSync, strToU8 } from "fflate"

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function sharedStringsXml(values: string[]): string {
  const items = values
    .map((v) => `<si><t xml:space="preserve">${escapeXml(v)}</t></si>`)
    .join("")
  return `${XML_HEADER}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${values.length}" uniqueCount="${values.length}">${items}</sst>`
}

function sheetXml(
  rows: unknown[][],
  sharedStrings: string[],
  styleId: number,
  numStyleId: number,
): string {
  let body = ""
  rows.forEach((row, r) => {
    const cells = row
      .map((val, c) => {
        const ref = colLetter(c) + (r + 1)
        if (val === null || val === undefined) {
          return `<c r="${ref}"/>`
        }
        if (typeof val === "number") {
          return `<c r="${ref}" s="${numStyleId}"><v>${val}</v></c>`
        }
        if (typeof val === "boolean") {
          return `<c r="${ref}" t="b"><v>${val ? 1 : 0}</v></c>`
        }
        const s = String(val)
        const idx = sharedStrings.indexOf(s)
        return `<c r="${ref}" s="${styleId}" t="s"><v>${idx}</v></c>`
      })
      .join("")
    body += `<row r="${r + 1}">${cells}</row>`
  })
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
}

function colLetter(i: number): string {
  let s = ""
  let n = i
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  }
  return s
}

const CONTENT_TYPES = `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`

const RELS = `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`

const WORKBOOK_RELS = `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`

const WORKBOOK = `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`

const STYLES = `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf xfId="0"/><xf xfId="0" applyFont="1" fontId="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

export function buildXlsx(headers: string[], rows: unknown[][]): Uint8Array {
  const sharedStrings = [...headers, ...rows.flat().map((v) => (v === null || v === undefined ? "" : String(v)))]
  const headerStyle = 1
  const numStyle = 0
  const dataRows = [headers, ...rows]
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(RELS),
    "xl/workbook.xml": strToU8(WORKBOOK),
    "xl/_rels/workbook.xml.rels": strToU8(WORKBOOK_RELS),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml(dataRows, sharedStrings, headerStyle, numStyle)),
    "xl/styles.xml": strToU8(STYLES),
    "xl/sharedStrings.xml": strToU8(sharedStringsXml(sharedStrings)),
  }
  return zipSync(files, { level: 6 })
}
