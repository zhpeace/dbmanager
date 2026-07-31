use chrono::Utc;
use cron::Schedule;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use tokio::sync::Mutex;

use super::types::{ColumnMapping, ConflictStrategy, ErrorMode, ForeignKeyAction, TransferMode};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TaskConfig {
    Backup {
        source_id: String,
        database: String,
        tables: Vec<String>,
        output_path: String,
    },
    Transfer {
        source_id: String,
        source_database: String,
        target_id: String,
        target_database: String,
        tables: Vec<String>,
        #[serde(default)]
        mode: TransferMode,
        #[serde(default)]
        conflict_strategy: ConflictStrategy,
        #[serde(default)]
        drop_target: bool,
        #[serde(default)]
        truncate_target: bool,
        #[serde(default)]
        where_clause: Option<String>,
        #[serde(default)]
        row_limit: Option<i64>,
        #[serde(default = "default_page_size")]
        page_size: u32,
        #[serde(default = "default_parallelism")]
        parallelism: u32,
        #[serde(default)]
        transfer_indexes: bool,
        #[serde(default)]
        transfer_foreign_keys: bool,
        #[serde(default)]
        transfer_views: bool,
        #[serde(default)]
        transfer_routines: bool,
        #[serde(default)]
        transfer_triggers: bool,
        #[serde(default)]
        foreign_key_action: ForeignKeyAction,
        #[serde(default)]
        column_mappings: Vec<ColumnMapping>,
        #[serde(default)]
        error_mode: ErrorMode,
    },
}

fn default_page_size() -> u32 { 2000 }
fn default_parallelism() -> u32 { 4 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledTask {
    pub id: String,
    pub name: String,
    pub cron_expr: String,
    pub enabled: bool,
    pub config: TaskConfig,
    pub created_at: String,
    pub last_run: Option<String>,
    pub next_run: Option<String>,
    pub last_result: Option<String>,
}

impl ScheduledTask {
    pub fn compute_next_run(&mut self) {
        match Schedule::from_str(&self.cron_expr) {
            Ok(sched) => {
                if let Some(next) = sched.upcoming(Utc).next() {
                    self.next_run = Some(next.to_rfc3339());
                }
            }
            Err(_) => {
                self.next_run = None;
            }
        }
    }
}

pub struct SchedulerManager {
    pub tasks: Mutex<Vec<ScheduledTask>>,
    pub cancel_tx: tokio::sync::watch::Sender<bool>,
}

impl SchedulerManager {
    pub fn new(tasks: Vec<ScheduledTask>) -> Self {
        let (cancel_tx, _) = tokio::sync::watch::channel(false);
        Self {
            tasks: Mutex::new(tasks),
            cancel_tx,
        }
    }
}
