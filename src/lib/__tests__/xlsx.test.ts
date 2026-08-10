import { buildXlsx } from "@/lib/xlsx"
import { unzipSync, strFromU8 } from "fflate"

function unzipText(xlsx: Uint8Array, path: string): string {
  const files = unzipSync(xlsx)
  return strFromU8(files[path])
}

describe("buildXlsx", () => {
  it("produces a valid xlsx zip with worksheet content", () => {
    const bytes = buildXlsx(
      ["id", "name"],
      [
        [1, "Alice"],
        [2, "Bob"],
      ],
    )
    expect(bytes.length).toBeGreaterThan(0)
    const sheet = unzipText(bytes, "xl/worksheets/sheet1.xml")
    expect(sheet).toContain("<row r=\"1\"")
    expect(sheet).toContain("<row r=\"3\"")
    expect(sheet).toContain("t=\"s\"")
    const contentTypes = unzipText(bytes, "[Content_Types].xml")
    expect(contentTypes).toContain("spreadsheetml.sheet.main+xml")
    const strings = unzipText(bytes, "xl/sharedStrings.xml")
    expect(strings).toContain("Alice")
    expect(strings).toContain("Bob")
  })

  it("escapes XML special characters", () => {
    const bytes = buildXlsx(["a"], [["<b>&\"x\"</b>"]])
    const sheet = unzipText(bytes, "xl/worksheets/sheet1.xml")
    expect(sheet).not.toContain("<b>&\"x\"</b>")
    const strings = unzipText(bytes, "xl/sharedStrings.xml")
    expect(strings).toContain("&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;")
  })

  it("writes numbers as numeric cells", () => {
    const bytes = buildXlsx(["v"], [[42]])
    const sheet = unzipText(bytes, "xl/worksheets/sheet1.xml")
    expect(sheet).toContain("<v>42</v>")
  })
})
