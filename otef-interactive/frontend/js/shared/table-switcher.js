// Table Switcher - Shared utility for switching between tables
// Works across dashboard, OTEF, projection, and remote-controller pages

class TableSwitcher {
  constructor(options = {}) {
    this.currentTable = this.getTableFromURL() || options.defaultTable || 'idistrict';
    this.availableTables = [];
    this.onTableChange = options.onTableChange || null;
    this.apiBase = options.apiBase || '/api';
    this.fetchTables();
  }

  /**
   * Get table name from URL query parameter
   */
  getTableFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get('table');
  }

  /**
   * Update URL with table parameter
   */
  updateURL(tableName, replace = false) {
    const url = new URL(window.location.href);
    url.searchParams.set('table', tableName);
    if (replace) {
      window.history.replaceState({}, '', url);
    } else {
      window.history.pushState({}, '', url);
    }
  }

  /**
   * Fetch available tables from API
   */
  async fetchTables() {
    try {
      const response = await fetch(`${this.apiBase}/tables/?is_active=true`);
      if (response.ok) {
        const data = await response.json();
        this.availableTables = Array.isArray(data) ? data : [];
      }
    } catch (error) {
      console.error('[TableSwitcher] Error fetching tables:', error);
    }
  }

  /**
   * Switch to a different table
   */
  async switchTable(tableName) {
    if (tableName === this.currentTable) return;
    
    this.currentTable = tableName;
    this.updateURL(tableName, true);
    
    if (this.onTableChange) {
      this.onTableChange(tableName);
    }
    
    // Dispatch custom event for other components
    window.dispatchEvent(new CustomEvent('tableChanged', { 
      detail: { table: tableName } 
    }));
  }

  /**
   * Create a table switcher UI element
   */
  createSwitcherUI(containerId = 'table-switcher') {
    const container = document.getElementById(containerId);
    if (!container) {
      console.warn(`[TableSwitcher] Container #${containerId} not found`);
      return;
    }

    // Create switcher HTML
    const switcher = document.createElement('div');
    switcher.className = 'table-switcher';
    switcher.innerHTML = `
      <select id="table-select" class="table-select">
        ${this.availableTables.map(table => 
          `<option value="${table.name}" ${table.name === this.currentTable ? 'selected' : ''}>
            ${table.display_name || table.name}
          </option>`
        ).join('')}
      </select>
    `;

    container.appendChild(switcher);

    // Add event listener
    const select = switcher.querySelector('#table-select');
    select.addEventListener('change', (e) => {
      this.switchTable(e.target.value);
    });

    // Update when tables are loaded
    this.fetchTables().then(() => {
      select.innerHTML = this.availableTables.map(table => 
        `<option value="${table.name}" ${table.name === this.currentTable ? 'selected' : ''}>
          ${table.display_name || table.name}
        </option>`
      ).join('');
    });
  }

  /**
   * Get current table name
   */
  getCurrentTable() {
    return this.currentTable;
  }

  /**
   * Check if current table is OTEF
   */
  isOTEF() {
    return this.currentTable === 'otef';
  }

  /**
   * Check if current table is idistrict
   */
  isIdistrict() {
    return this.currentTable === 'idistrict';
  }
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = TableSwitcher;
}
