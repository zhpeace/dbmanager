use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct DatabaseInfo {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FindMatch {
    pub table: String,
    pub column: String,
    pub value: String,
    pub row: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub object_type: String,
    pub schema: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDef {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub primary_key: bool,
    pub default_value: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub key: String,
    pub default_value: Option<String>,
    pub extra: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<serde_json::Value>,
    pub row_count: usize,
    pub duration: String,
    pub error: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
pub struct TableData {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<serde_json::Value>,
    pub total: i64,
    pub duration: String,
    pub primary_keys: Vec<String>,
    pub row_handles: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKeyInfo {
    pub column_name: String,
    pub ref_table: String,
    pub ref_column: String,
    pub constraint_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub index_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewInfo {
    pub name: String,
    pub definition: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutineInfo {
    pub name: String,
    pub routine_type: String,
    pub definition: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerInfo {
    pub name: String,
    pub table: String,
    pub definition: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TableSchemaInfo {
    pub table: String,
    pub columns: Vec<ColumnInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
    pub indexes: Vec<IndexInfo>,
    pub views: Vec<ViewInfo>,
    pub routines: Vec<RoutineInfo>,
    pub triggers: Vec<TriggerInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SchemaCache {
    pub tables: Vec<TableSchemaInfo>,
    pub views: Vec<ViewInfo>,
    pub routines: Vec<RoutineInfo>,
    pub triggers: Vec<TriggerInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConflictStrategy {
    #[serde(rename = "error")]
    Error,
    #[serde(rename = "ignore")]
    Ignore,
    #[serde(rename = "replace")]
    Replace,
}

impl Default for ConflictStrategy {
    fn default() -> Self {
        ConflictStrategy::Error
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TransferMode {
    #[serde(rename = "structure_and_data")]
    StructureAndData,
    #[serde(rename = "structure_only")]
    StructureOnly,
    #[serde(rename = "data_only")]
    DataOnly,
}

impl Default for TransferMode {
    fn default() -> Self {
        TransferMode::StructureAndData
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ForeignKeyAction {
    #[serde(rename = "preserve")]
    Preserve,
    #[serde(rename = "disable")]
    Disable,
    #[serde(rename = "skip")]
    Skip,
}

impl Default for ForeignKeyAction {
    fn default() -> Self {
        ForeignKeyAction::Preserve
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ErrorMode {
    #[serde(rename = "skip")]
    Skip,
    #[serde(rename = "stop")]
    Stop,
    #[serde(rename = "skip_table")]
    SkipTable,
}

impl Default for ErrorMode {
    fn default() -> Self {
        ErrorMode::Skip
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnMapping {
    pub source_column: String,
    pub target_column: String,
    pub skip: bool,
    pub default_value: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferOptions {
    pub source_id: String,
    pub source_database: String,
    pub target_id: String,
    pub target_database: String,
    pub tables: Vec<String>,
    #[serde(default)]
    pub mode: TransferMode,
    #[serde(default)]
    pub conflict_strategy: ConflictStrategy,
    #[serde(default)]
    pub drop_target: bool,
    #[serde(default)]
    pub truncate_target: bool,
    #[serde(default)]
    pub where_clause: Option<String>,
    #[serde(default)]
    pub row_limit: Option<i64>,
    #[serde(default = "default_page_size")]
    pub page_size: u32,
    #[serde(default = "default_parallelism")]
    pub parallelism: u32,
    #[serde(default)]
    pub transfer_indexes: bool,
    #[serde(default)]
    pub transfer_foreign_keys: bool,
    #[serde(default)]
    pub transfer_views: bool,
    #[serde(default)]
    pub transfer_routines: bool,
    #[serde(default)]
    pub transfer_triggers: bool,
    #[serde(default)]
    pub foreign_key_action: ForeignKeyAction,
    #[serde(default)]
    pub column_mappings: Vec<ColumnMapping>,
    #[serde(default)]
    pub checkpoint_id: Option<String>,
    #[serde(default)]
    pub error_mode: ErrorMode,
}

fn default_page_size() -> u32 { 2000 }
fn default_parallelism() -> u32 { 4 }

impl Default for TransferOptions {
    fn default() -> Self {
        Self {
            source_id: String::new(),
            source_database: String::new(),
            target_id: String::new(),
            target_database: String::new(),
            tables: Vec::new(),
            mode: TransferMode::default(),
            conflict_strategy: ConflictStrategy::default(),
            drop_target: false,
            truncate_target: false,
            where_clause: None,
            row_limit: None,
            page_size: default_page_size(),
            parallelism: default_parallelism(),
            transfer_indexes: true,
            transfer_foreign_keys: false,
            transfer_views: false,
            transfer_routines: false,
            transfer_triggers: false,
            foreign_key_action: ForeignKeyAction::default(),
            column_mappings: Vec::new(),
            checkpoint_id: None,
            error_mode: ErrorMode::default(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TransferResult {
    pub tables_transferred: Vec<String>,
    pub rows_transferred: i64,
    pub errors: Vec<String>,
    pub duration: String,
    pub logs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CheckpointState {
    pub completed_tables: Vec<String>,
    pub failed_tables: Vec<String>,
    pub rows_transferred: i64,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
pub struct RedisKeyInfo {
    pub key: String,
    pub key_type: String,
    pub ttl: i64,
    pub value: serde_json::Value,
    pub size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDiff {
    pub name: String,
    pub source_type: Option<String>,
    pub target_type: Option<String>,
    pub source_nullable: Option<bool>,
    pub target_nullable: Option<bool>,
    pub source_default: Option<String>,
    pub target_default: Option<String>,
    pub source_key: Option<String>,
    pub target_key: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexDiff {
    pub name: String,
    pub source_columns: Vec<String>,
    pub target_columns: Vec<String>,
    pub source_unique: bool,
    pub target_unique: bool,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FkDiff {
    pub column_name: String,
    pub source_ref: Option<String>,
    pub target_ref: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableDiff {
    pub table: String,
    pub status: String,
    pub columns: Vec<ColumnDiff>,
    pub indexes: Vec<IndexDiff>,
    pub foreign_keys: Vec<FkDiff>,
    pub sync_sql: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareResult {
    pub tables: Vec<TableDiff>,
    pub extra_in_source: Vec<String>,
    pub extra_in_target: Vec<String>,
    pub summary: String,
}
