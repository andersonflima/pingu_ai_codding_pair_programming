import { useState } from "react";

export function DiceButton() {
  const [value] = useState(20);
  return <button>{value}</button>;
}

