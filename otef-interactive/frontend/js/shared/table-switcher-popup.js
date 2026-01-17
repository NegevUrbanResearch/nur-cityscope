// Table Switcher Popup - Keyboard-driven table switching
// Similar to calibration panel in nur-projection

class TableSwitcherPopup {
  constructor(tableSwitcher) {
    this.tableSwitcher = tableSwitcher;
    this.isOpen = false;
    this.popup = null;
    this.init();
  }

  init() {
    this.createPopup();
    this.attachKeyboardListeners();
    
    // Listen for table changes to update popup content
    window.addEventListener('tableChanged', () => {
      if (this.isOpen) {
        this.updateContent();
      }
    });
    
    // Update content when tables are loaded
    const checkTables = setInterval(() => {
      if (this.tableSwitcher.availableTables.length > 0) {
        if (this.isOpen) {
          this.updateContent();
        }
        clearInterval(checkTables);
      }
    }, 100);
  }

  createPopup() {
    this.popup = document.createElement('div');
    this.popup.id = 'table-switcher-popup';
    this.popup.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background-color: rgba(0, 0, 0, 0.85);
      color: white;
      padding: 15px;
      border-radius: 5px;
      font-family: Arial, sans-serif;
      z-index: 10000;
      display: none;
      min-width: 280px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    `;
    
    this.updateContent();
    document.body.appendChild(this.popup);
  }

  updateContent() {
    const currentTable = this.tableSwitcher.getCurrentTable();
    const availableTables = this.tableSwitcher.availableTables;
    const currentTableDisplayName = availableTables.find(t => t.name === currentTable)?.display_name || currentTable;

    this.popup.innerHTML = `
      <h3 style="margin-top: 0; margin-bottom: 10px; color: #64B5F6; font-size: 1.1rem;">Table Switcher</h3>
      <p style="margin: 5px 0;">
        <strong style="color: rgba(255,255,255,0.7);">Current Table:</strong><br>
        <span style="color: #64B5F6; font-weight: 600;">${currentTableDisplayName}</span>
      </p>
      <p style="margin: 10px 0 5px 0;">
        <strong style="color: rgba(255,255,255,0.7);">Available Tables:</strong>
      </p>
      <div style="margin-bottom: 10px;">
        ${availableTables.map(table => {
          const isCurrent = table.name === currentTable;
          return `
            <div style="
              padding: 4px;
              background-color: ${isCurrent ? 'rgba(100, 181, 246, 0.2)' : 'transparent'};
              border-radius: 4px;
              color: ${isCurrent ? '#64B5F6' : 'rgba(255,255,255,0.85)'};
              font-weight: ${isCurrent ? '600' : '400'};
            ">
              ${table.display_name || table.name}
            </div>
          `;
        }).join('')}
      </div>
      <div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);">
        <p style="margin: 5px 0; color: rgba(255,255,255,0.7);"><strong>Keyboard Shortcuts:</strong></p>
        <p style="margin: 5px 0; font-size: 0.85rem; line-height: 1.6;">
          <strong>Shift+Z</strong> - Toggle this panel<br>
          <strong>T</strong> - Switch to next table (when panel is open)<br>
          <strong>Esc</strong> - Close panel
        </p>
      </div>
    `;
  }

  toggle() {
    this.isOpen = !this.isOpen;
    this.popup.style.display = this.isOpen ? 'block' : 'none';
    if (this.isOpen) {
      this.updateContent();
    }
  }

  switchToNextTable() {
    const availableTables = this.tableSwitcher.availableTables;
    if (availableTables.length === 0) return;
    
    const currentTable = this.tableSwitcher.getCurrentTable();
    const currentIndex = availableTables.findIndex(t => t.name === currentTable);
    const nextIndex = (currentIndex + 1) % availableTables.length;
    const nextTable = availableTables[nextIndex];
    
    if (nextTable && nextTable.name !== currentTable) {
      this.tableSwitcher.switchTable(nextTable.name);
      this.updateContent();
    }
  }

  attachKeyboardListeners() {
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Z' && event.shiftKey) {
        event.preventDefault();
        this.toggle();
      } else if (this.isOpen && event.key === 'T' && !event.shiftKey) {
        event.preventDefault();
        this.switchToNextTable();
      } else if (this.isOpen && event.key === 'Escape') {
        event.preventDefault();
        this.isOpen = false;
        this.popup.style.display = 'none';
      }
    });
  }
}
