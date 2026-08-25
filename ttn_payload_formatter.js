function decodeUplink(input) {
  var b = input.bytes;

  function u16(i) {
    return (b[i] << 8) | b[i + 1];
  }

  function s16(i) {
    var value = u16(i);
    return value > 32767 ? value - 65536 : value;
  }

  if (b.length < 12) {
    return {
      errors: ["Payload mora imati najmanje 12 bajtova."]
    };
  }

  return {
    data: {
      pm25: u16(0),
      pm10: u16(2),
      co2: u16(4),
      temperatura: s16(6) / 10,
      vlaga: u16(8) / 10,
      tlak: u16(10) / 10
    }
  };
}
