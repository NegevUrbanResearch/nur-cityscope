import React from 'react';

const VolumeControl = ({ volume }) => {
  const containerStyle = {
    width: '100px', // Adjust the line width as needed
    height: '20px',
    position: 'relative',
    border: '1px solid #ccc', // You can change the border color as needed
    borderRadius: '10px',
  };

  let color = '';
  if (volume <= 33) {
    color = 'red'; // color for range 0-33%
  } else if (volume <= 66) {
    color = 'yellow'; // color for range 34-66%
  } else {
    color = 'green'; // color for range 67-100%
  }

  const indicatorStyle = {
    width: '20px', // Adjust the circular indicator diameter
    height: '20px',
    backgroundColor: color,
    borderRadius: '50%',
    position: 'absolute',
    left: `calc(${volume}% - 10px)`, // Position the indicator on the line according to volume
    top: '50%',
    transform: 'translateY(-50%) ',
  };

  return (
    <div style={containerStyle}>
      <div style={indicatorStyle}></div>
    </div>
  );
};

const TrafficLightTable = ({ data }) => {
  return (
    <table>
      <thead>
        <tr>
          <th></th>
          {data.map((category, index) => (
            <th key={index}>{category.name}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td></td>
          {data.map((category, index) => (
            <td key={index}>
              <div style={{ textAlign: 'center' }}>
                <p>{category.indicator1}</p>
              </div>
              <VolumeControl volume={category.indicator1} />
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
};

export default TrafficLightTable;