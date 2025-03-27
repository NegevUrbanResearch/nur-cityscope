import React from 'react';

const MapLegend = ({ data }) => {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: '100px' }}>
      <h3>Leyendas del Mapa</h3>
          <div style={{
            width: '30px',  // Ancho de la barra de colores en gradiente
            height: '20px',  // Altura de la barra de colores en gradiente
          }}></div>
      <table>
        <tbody>
          <tr>
            <td>
              <div style={{
                width: '300px',  // Ancho de la barra de colores en gradiente
                height: '20px',  // Altura de la barra de colores en gradiente
                background: 'linear-gradient(to right, #ff0000, #FFFF00, #00FF00)', // Definición del gradiente
              }}></div>
            </td>
          </tr>
          <tr>
            <td>
            <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{
                  width: '15px',  // Ancho de la barra de colores en gradiente
                  height: '20px',  // Altura de la barra de colores en gradiente
                }}></div>
                <span>Inicio</span>
                <div style={{
                  width: '80px',  // Ancho de la barra de colores en gradiente
                  height: '20px',  // Altura de la barra de colores en gradiente
                }}></div>
                <span>Medio</span>
                <div style={{
                  width: '80px',  // Ancho de la barra de colores en gradiente
                  height: '20px',  // Altura de la barra de colores en gradiente
                }}></div>
                <span>Fin</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};


export default MapLegend;
