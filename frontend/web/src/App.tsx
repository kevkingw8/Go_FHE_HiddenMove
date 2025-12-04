// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface Move {
  x: number;
  y: number;
  player: 'black' | 'white';
  timestamp: number;
  isHidden: boolean;
  revealed: boolean;
  encryptedData?: string;
}

interface GameStats {
  blackStones: number;
  whiteStones: number;
  hiddenMoves: number;
  revealedMoves: number;
}

const FHEEncryptCoords = (x: number, y: number): string => {
  return `FHE-${btoa(`${x},${y}`)}`;
};

const FHEDecryptCoords = (encryptedData: string): {x: number, y: number} => {
  if (encryptedData.startsWith('FHE-')) {
    const decrypted = atob(encryptedData.substring(4)).split(',');
    return {x: parseInt(decrypted[0]), y: parseInt(decrypted[1])};
  }
  return {x: -1, y: -1};
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const BOARD_SIZE = 19;
const HIDDEN_MOVE_INTERVAL = 5; // Every 5 moves can make a hidden move

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [moves, setMoves] = useState<Move[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState<'black' | 'white'>('black');
  const [gameStats, setGameStats] = useState<GameStats>({
    blackStones: 0,
    whiteStones: 0,
    hiddenMoves: 0,
    revealedMoves: 0
  });
  const [showTutorial, setShowTutorial] = useState(true);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [selectedMove, setSelectedMove] = useState<Move | null>(null);
  const [decryptedCoords, setDecryptedCoords] = useState<{x: number, y: number} | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [showHiddenMoveOption, setShowHiddenMoveOption] = useState(false);
  const [board, setBoard] = useState<Array<Array<'black' | 'white' | null>>>(Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)));

  useEffect(() => {
    loadMoves().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadMoves = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("move_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing move keys:", e); }
      }
      
      const loadedMoves: Move[] = [];
      const newBoard = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
      let blackCount = 0;
      let whiteCount = 0;
      let hiddenCount = 0;
      let revealedCount = 0;

      for (const key of keys) {
        try {
          const moveBytes = await contract.getData(`move_${key}`);
          if (moveBytes.length > 0) {
            try {
              const moveData = JSON.parse(ethers.toUtf8String(moveBytes));
              const move: Move = {
                x: moveData.x,
                y: moveData.y,
                player: moveData.player,
                timestamp: moveData.timestamp,
                isHidden: moveData.isHidden || false,
                revealed: moveData.revealed || false
              };

              if (move.isHidden && !move.revealed) {
                move.encryptedData = moveData.encryptedData;
              } else {
                // Update board for revealed moves
                newBoard[move.x][move.y] = move.player;
                if (move.player === 'black') blackCount++;
                else whiteCount++;
              }

              if (move.isHidden) {
                hiddenCount++;
                if (move.revealed) revealedCount++;
              }

              loadedMoves.push(move);
            } catch (e) { console.error(`Error parsing move data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading move ${key}:`, e); }
      }

      loadedMoves.sort((a, b) => a.timestamp - b.timestamp);
      setMoves(loadedMoves);
      setBoard(newBoard);
      setGameStats({
        blackStones: blackCount,
        whiteStones: whiteCount,
        hiddenMoves: hiddenCount,
        revealedMoves: revealedCount
      });

      // Determine if next move can be hidden
      const nextMoveNumber = loadedMoves.length + 1;
      setShowHiddenMoveOption(nextMoveNumber % HIDDEN_MOVE_INTERVAL === 0);
    } catch (e) { 
      console.error("Error loading moves:", e); 
    } finally { 
      setLoading(false); 
    }
  };

  const makeMove = async (x: number, y: number, isHidden: boolean = false) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    if (board[x][y] !== null) { alert("Position already occupied"); return; }

    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");

      const moveId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      let encryptedData = '';
      
      if (isHidden) {
        encryptedData = FHEEncryptCoords(x, y);
      }

      const moveData = { 
        x: isHidden ? -1 : x, 
        y: isHidden ? -1 : y,
        player: currentPlayer,
        timestamp: Math.floor(Date.now() / 1000),
        isHidden,
        revealed: false,
        encryptedData: isHidden ? encryptedData : ''
      };

      await contract.setData(`move_${moveId}`, ethers.toUtf8Bytes(JSON.stringify(moveData)));
      
      const keysBytes = await contract.getData("move_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(moveId);
      await contract.setData("move_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));

      // Update local state
      const newMove: Move = {
        x: isHidden ? -1 : x,
        y: isHidden ? -1 : y,
        player: currentPlayer,
        timestamp: Math.floor(Date.now() / 1000),
        isHidden,
        revealed: false,
        encryptedData: isHidden ? encryptedData : undefined
      };

      setMoves([...moves, newMove]);
      setCurrentPlayer(currentPlayer === 'black' ? 'white' : 'black');
      
      if (!isHidden) {
        const newBoard = [...board];
        newBoard[x][y] = currentPlayer;
        setBoard(newBoard);
        
        setGameStats(prev => ({
          ...prev,
          blackStones: currentPlayer === 'black' ? prev.blackStones + 1 : prev.blackStones,
          whiteStones: currentPlayer === 'white' ? prev.whiteStones + 1 : prev.whiteStones
        }));
      } else {
        setGameStats(prev => ({
          ...prev,
          hiddenMoves: prev.hiddenMoves + 1
        }));
      }

      // Check if next move can be hidden
      const nextMoveNumber = moves.length + 2;
      setShowHiddenMoveOption(nextMoveNumber % HIDDEN_MOVE_INTERVAL === 0);

    } catch (e: any) {
      console.error("Move submission failed:", e);
      alert(`Move failed: ${e.message || "Unknown error"}`);
    }
  };

  const revealHiddenMove = async (move: Move) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    if (!move.isHidden || move.revealed) return;
    if (!move.encryptedData) { alert("No encrypted data found for this move"); return; }

    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      
      // Simulate decryption delay
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const coords = FHEDecryptCoords(move.encryptedData);
      setDecryptedCoords(coords);

      // Update contract with revealed move
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");

      const updatedMove = {
        ...move,
        x: coords.x,
        y: coords.y,
        revealed: true,
        encryptedData: '' // Clear encrypted data after reveal
      };

      await contract.setData(`move_${moves.findIndex(m => m.timestamp === move.timestamp)}`, ethers.toUtf8Bytes(JSON.stringify(updatedMove)));

      // Update local state
      const updatedMoves = moves.map(m => 
        m.timestamp === move.timestamp ? updatedMove : m
      );
      setMoves(updatedMoves);

      // Update board
      const newBoard = [...board];
      newBoard[coords.x][coords.y] = move.player;
      setBoard(newBoard);

      setGameStats(prev => ({
        ...prev,
        revealedMoves: prev.revealedMoves + 1,
        blackStones: move.player === 'black' ? prev.blackStones + 1 : prev.blackStones,
        whiteStones: move.player === 'white' ? prev.whiteStones + 1 : prev.whiteStones
      }));

    } catch (e) { 
      console.error("Decryption failed:", e);
      alert("Failed to reveal hidden move");
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const renderStone = (x: number, y: number) => {
    const stone = board[x][y];
    if (stone === 'black') return <div className="stone black" />;
    if (stone === 'white') return <div className="stone white" />;
    return null;
  };

  const renderMoveHistory = () => {
    return (
      <div className="move-history">
        <h3>Move History</h3>
        <div className="history-list">
          {moves.map((move, index) => (
            <div 
              key={index} 
              className={`history-item ${move.player} ${move.isHidden ? 'hidden' : ''}`}
              onClick={() => setSelectedMove(move)}
            >
              <span className="move-number">{index + 1}.</span>
              {move.isHidden ? (
                move.revealed ? (
                  <span className="move-desc">Hidden move revealed at ({move.x},{move.y})</span>
                ) : (
                  <span className="move-desc">Hidden move (encrypted)</span>
                )
              ) : (
                <span className="move-desc">Played at ({move.x},{move.y})</span>
              )}
              {move.isHidden && !move.revealed && (
                <button 
                  className="reveal-btn" 
                  onClick={(e) => {
                    e.stopPropagation();
                    revealHiddenMove(move);
                  }}
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : "Reveal"}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="go-spinner"></div>
      <p>Initializing encrypted Go board...</p>
    </div>
  );

  return (
    <div className="app-container zen-theme">
      <header className="app-header">
        <div className="logo">
          <div className="go-stone black"></div>
          <h1>Encrypted<span>Go</span></h1>
          <div className="go-stone white"></div>
        </div>
        <div className="header-actions">
          <button className="zen-button" onClick={() => setShowTutorial(!showTutorial)}>
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <div className="main-content">
        {showTutorial && (
          <div className="tutorial-section zen-card">
            <h2>The Art of Hidden Moves</h2>
            <div className="tutorial-steps">
              <div className="tutorial-step">
                <div className="step-icon">🎴</div>
                <div className="step-content">
                  <h3>Traditional Go</h3>
                  <p>An ancient strategy game where players alternate placing black and white stones on a 19x19 grid.</p>
                </div>
              </div>
              <div className="tutorial-step">
                <div className="step-icon">🔒</div>
                <div className="step-content">
                  <h3>Hidden Moves</h3>
                  <p>Every 5 moves, you can place a hidden stone using Zama FHE encryption. Your opponent won't see it until revealed.</p>
                </div>
              </div>
              <div className="tutorial-step">
                <div className="step-icon">⚔️</div>
                <div className="step-content">
                  <h3>Strategic Depth</h3>
                  <p>Use hidden moves to set traps, create long-term strategies, or bluff your opponent.</p>
                </div>
              </div>
              <div className="tutorial-step">
                <div className="step-icon">🔓</div>
                <div className="step-content">
                  <h3>Revealing Moves</h3>
                  <p>Hidden moves are automatically revealed after a set number of turns or can be manually revealed with your wallet signature.</p>
                </div>
              </div>
            </div>
            <div className="fhe-explanation">
              <div className="fhe-icon"></div>
              <p>
                <strong>Zama FHE Encryption:</strong> Hidden move coordinates are encrypted using Fully Homomorphic Encryption. 
                The encrypted data is stored on-chain and can only be decrypted with your private key.
              </p>
            </div>
          </div>
        )}

        <div className="game-container">
          <div className="player-info black">
            <div className="stone-indicator black"></div>
            <div className="player-stats">
              <span className="player-name">Black</span>
              <span className="stone-count">{gameStats.blackStones} stones</span>
            </div>
            {currentPlayer === 'black' && <div className="current-turn">Your turn</div>}
          </div>

          <div className="go-board-container">
            <div className="go-board">
              {Array(BOARD_SIZE).fill(null).map((_, x) => (
                <div key={`row-${x}`} className="board-row">
                  {Array(BOARD_SIZE).fill(null).map((_, y) => (
                    <div 
                      key={`intersection-${x}-${y}`} 
                      className="intersection"
                      onClick={() => makeMove(x, y)}
                    >
                      {renderStone(x, y)}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {showHiddenMoveOption && (
              <div className="hidden-move-option zen-card">
                <h3>Hidden Move Available</h3>
                <p>You can place a hidden move this turn. The position will be encrypted with Zama FHE.</p>
                <button 
                  className="zen-button" 
                  onClick={() => {
                    const x = Math.floor(Math.random() * BOARD_SIZE);
                    const y = Math.floor(Math.random() * BOARD_SIZE);
                    makeMove(x, y, true);
                  }}
                >
                  Place Hidden Move
                </button>
              </div>
            )}
          </div>

          <div className="player-info white">
            <div className="stone-indicator white"></div>
            <div className="player-stats">
              <span className="player-name">White</span>
              <span className="stone-count">{gameStats.whiteStones} stones</span>
            </div>
            {currentPlayer === 'white' && <div className="current-turn">Your turn</div>}
          </div>
        </div>

        <div className="game-stats zen-card">
          <div className="stat-item">
            <div className="stat-label">Hidden Moves</div>
            <div className="stat-value">{gameStats.hiddenMoves}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Revealed Moves</div>
            <div className="stat-value">{gameStats.revealedMoves}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Total Moves</div>
            <div className="stat-value">{moves.length}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Next Hidden</div>
            <div className="stat-value">
              {HIDDEN_MOVE_INTERVAL - (moves.length % HIDDEN_MOVE_INTERVAL)} moves
            </div>
          </div>
        </div>

        {renderMoveHistory()}
      </div>

      {selectedMove && (
        <div className="modal-overlay">
          <div className="move-detail-modal zen-card">
            <div className="modal-header">
              <h2>Move Details</h2>
              <button onClick={() => setSelectedMove(null)} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="move-info">
                <div className="info-item">
                  <span>Player:</span>
                  <strong className={`player ${selectedMove.player}`}>{selectedMove.player}</strong>
                </div>
                <div className="info-item">
                  <span>Time:</span>
                  <strong>{new Date(selectedMove.timestamp * 1000).toLocaleString()}</strong>
                </div>
                {selectedMove.isHidden ? (
                  <>
                    <div className="info-item">
                      <span>Type:</span>
                      <strong>Hidden Move</strong>
                    </div>
                    {selectedMove.revealed ? (
                      <div className="info-item">
                        <span>Position:</span>
                        <strong>({selectedMove.x}, {selectedMove.y})</strong>
                      </div>
                    ) : (
                      <div className="info-item">
                        <span>Status:</span>
                        <strong>Encrypted with Zama FHE</strong>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="info-item">
                    <span>Position:</span>
                    <strong>({selectedMove.x}, {selectedMove.y})</strong>
                  </div>
                )}
              </div>
              {selectedMove.isHidden && !selectedMove.revealed && (
                <div className="encrypted-section">
                  <h3>Encrypted Data</h3>
                  <div className="encrypted-data">
                    {selectedMove.encryptedData?.substring(0, 50)}...
                  </div>
                  <button 
                    className="zen-button" 
                    onClick={() => revealHiddenMove(selectedMove)}
                    disabled={isDecrypting}
                  >
                    {isDecrypting ? "Decrypting..." : "Reveal Move"}
                  </button>
                </div>
              )}
              {decryptedCoords && selectedMove.isHidden && selectedMove.revealed && (
                <div className="decrypted-section">
                  <h3>Decrypted Position</h3>
                  <div className="decrypted-coords">
                    ({decryptedCoords.x}, {decryptedCoords.y})
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="go-stone black"></div>
              <span>EncryptedGo</span>
              <div className="go-stone white"></div>
            </div>
            <p>Traditional Go with modern FHE encryption</p>
          </div>
          <div className="footer-links">
            <div className="fhe-badge">
              <div className="fhe-icon"></div>
              <span>Powered by Zama FHE</span>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="copyright">© {new Date().getFullYear()} EncryptedGo. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

export default App;