import React from "react";

function Games() {
  return (
    <div className="games-page">
      <h1>HM Games</h1>

      <div className="game-grid">
        <button className="game-card">
          🎮 Multiplayer Game
        </button>

        <button className="game-card">
          🏎 Racing Game
        </button>

        <button className="game-card">
          ⚔ Battle Game
        </button>
      </div>
    </div>
  );
}

export default Games;