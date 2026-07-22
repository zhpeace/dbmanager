import { useTranslation } from "react-i18next"
import { Table2, Info } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable } from "./DataTable"
import type { QueryResult } from "@/lib/db"

interface ResultPanelProps {
  result: QueryResult | null
}

export function ResultPanel({ result }: ResultPanelProps) {
  const { t } = useTranslation()
  if (!result) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        <div className="text-center">
          <p>{t('resultpanel.empty_title')}</p>
          <p className="text-xs text-muted-foreground/60 mt-1">{t('resultpanel.empty_hint')}</p>
        </div>
      </div>
    )
  }

  return (
    <Tabs defaultValue="results" className="h-full flex flex-col">
      <div className="border-b px-3">
        <TabsList className="bg-transparent h-9">
          <TabsTrigger value="results" className="text-xs data-[state=active]:bg-background">
            <Table2 className="h-3.5 w-3.5 mr-1" />
            {t('resultpanel.tab_results')}
            {result.rowCount > 0 && (
              <span className="ml-1.5 rounded bg-muted px-1 py-0 text-[10px] font-mono">
                {result.rowCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="info" className="text-xs data-[state=active]:bg-background">
            <Info className="h-3.5 w-3.5 mr-1" />
            {t('resultpanel.tab_info')}
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="results" className="flex-1 mt-0 min-h-0 data-[state=active]:flex flex-col">
        <DataTable
          columns={result.columns}
          rows={result.rows}
          error={result.error}
          rowCount={result.rowCount}
        />
      </TabsContent>
      <TabsContent value="info" className="flex-1 mt-0 p-3 min-h-0">
        <div className="text-xs space-y-2 text-muted-foreground">
          <div className="flex justify-between">
            <span>{t('resultpanel.duration')}</span>
            <span className="font-mono">{result.duration}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('resultpanel.rows')}</span>
            <span className="font-mono">{result.rowCount}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('resultpanel.columns')}</span>
            <span className="font-mono">{result.columns.length}</span>
          </div>
          {result.columns.length > 0 && (
            <div>
              <p className="font-medium mb-1 mt-3">{t('resultpanel.columns_heading')}</p>
              <div className="space-y-0.5">
                {result.columns.map((col) => (
                  <div key={col} className="flex items-center gap-2 text-[11px]">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary/60" />
                    {col}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </TabsContent>
    </Tabs>
  )
}
