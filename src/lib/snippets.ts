export interface SqlSnippet {
  name: string
  description: string
  sql: string
}

export const SQL_SNIPPETS: SqlSnippet[] = [
  {
    name: "SELECT * FROM",
    description: "Select all columns from a table",
    sql: "SELECT * FROM ;",
  },
  {
    name: "SELECT DISTINCT",
    description: "Select distinct values",
    sql: "SELECT DISTINCT  FROM ;",
  },
  {
    name: "INSERT INTO",
    description: "Insert a new row",
    sql: "INSERT INTO  (, ) VALUES (, );",
  },
  {
    name: "UPDATE",
    description: "Update existing rows",
    sql: "UPDATE  SET  =  WHERE ;",
  },
  {
    name: "DELETE FROM",
    description: "Delete rows matching a condition",
    sql: "DELETE FROM  WHERE ;",
  },
  {
    name: "CREATE TABLE",
    description: "Create a new table",
    sql: "CREATE TABLE  (\n  id INT PRIMARY KEY,\n   VARCHAR(255)\n);",
  },
  {
    name: "CREATE INDEX",
    description: "Create an index on a column",
    sql: "CREATE INDEX idx__ ON  ();",
  },
  {
    name: "ALTER TABLE ADD COLUMN",
    description: "Add a column to an existing table",
    sql: "ALTER TABLE  ADD COLUMN  ;",
  },
  {
    name: "GROUP BY",
    description: "Aggregate rows by a column",
    sql: "SELECT , COUNT(*) FROM \nGROUP BY \nORDER BY ;",
  },
  {
    name: "JOIN",
    description: "Join two tables",
    sql: "SELECT a.*, b.*\nFROM  a\nJOIN  b ON a. = b.\nWHERE ;",
  },
  {
    name: "TRANSACTION",
    description: "Wrap statements in a transaction",
    sql: "BEGIN;\n;\n;\nCOMMIT;",
  },
  {
    name: "CREATE VIEW",
    description: "Create a view",
    sql: "CREATE VIEW  AS\nSELECT  FROM  WHERE ;",
  },
]
