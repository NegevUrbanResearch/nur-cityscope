import React from 'react';

const MapLegend = ({ data }) => {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: '100px' }}>
      <h3>Map Legends</h3>
          <div style={{
            width: '30px',  // Width of the color gradient bar
            height: '20px',  // Height of the color gradient bar
          }}></div>
      <table>
        <tbody>
          <tr>
            <td>
              <div style={{
                width: '300px',  // Width of the color gradient bar
                height: '20px',  // Height of the color gradient bar
                background: 'linear-gradient(to right, #ff0000, #FFFF00, #00FF00)', // Gradient definition
              }}></div>
            </td>
          </tr>
          <tr>
            <td>
            <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{
                  width: '15px',  // Width of the color gradient bar
                  height: '20px',  // Height of the color gradient bar
                }}></div>
                <span>Start</span>
                <div style={{
                  width: '80px',  // Width of the color gradient bar
                  height: '20px',  // Height of the color gradient bar
                }}></div>
                <span>Middle</span>
                <div style={{
                  width: '80px',  // Width of the color gradient bar
                  height: '20px',  // Height of the color gradient bar
                }}></div>
                <span>End</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

export default MapLegend;
