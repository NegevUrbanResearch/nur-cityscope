export const APP_CONFIG = Object.freeze({
  defaultTable: "otef",
  tables: Object.freeze({
    primary: "otef",
  }),
  api: Object.freeze({
    viewportBase: "/api/otef_viewport/by-table",
    boundsApply: "/api/otef/bounds/apply/",
  }),
  websocket: Object.freeze({
    channelTemplate: "otef_table_{table}",
  }),
});
