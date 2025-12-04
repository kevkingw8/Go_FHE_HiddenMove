# FHE-based Go (Weiqi) Game with Encrypted Hidden Moves

Experience the thrill of strategy and deception in an innovative, encrypted variant of the ancient game of Go. This project harnesses **Zama's Fully Homomorphic Encryption (FHE) technology** to introduce a completely new layer to the classic gameplay, allowing players to make concealed moves that remain hidden from their opponents until revealed in subsequent turns.

## The Challenge of Traditional Go

In the traditional game of Go, players engage in a deep psychological battle, employing strategy and foresight. However, the game can become predictable, and the element of surprise is often lost, which can lead to a less stimulating experience. Players may find themselves constrained by visible strategies, making it hard to execute unconventional moves that could shift the balance of the game.

## How FHE Transforms the Game

This project employs **Fully Homomorphic Encryption**, leveraging **Zama's open-source libraries** like **Concrete** and **TFHE-rs**. By encrypting the "hidden moves," players can deploy strategies that keep their intentions shrouded in mystery. The opponents won't see the hidden moves until they are revealed, thus enhancing psychological warfare and strategic deception, adding a fascinating twist to the game. As a result, the ancient tradition of Go is revitalized, offering players a modern and secure version of this beloved classic.

## Exciting Features

- **Encrypted Hidden Moves**: Players can make moves that are not visible to their opponents until predetermined turns, introducing a new dimension of strategy.
- **Automatic Reveal**: Hidden moves are revealed following a set number of turns, adding anticipation to the gameplay.
- **Enhanced Psychological Play**: The encryption creates uncertainty for opponents, fostering deeper strategic planning and decision-making.
- **Standard Go Board with Special Commands**: The interface remains true to Go while integrating unique commands for hidden moves.

## Technology Stack

This project employs a robust technology stack designed for confidentiality and seamless gameplay:

- **Zama SDK**: Fully Homomorphic Encryption libraries (Concrete and TFHE-rs)
- **Node.js**: For backend development and server-side logic
- **Hardhat**: To compile and deploy smart contracts
- **Solidity**: Contract development for the game mechanics
- **React**: Frontend framework for an interactive user interface

## Directory Structure

```
Go_FHE_HiddenMove/
├── contracts/
│   └── Go_FHE_HiddenMove.sol
├── src/
│   ├── index.js
│   ├── Game.js
│   └── Utilities.js
├── package.json
└── README.md
```

## Getting Started

To set up the project, ensure that you have **Node.js** and **Hardhat** installed on your machine. Follow these steps:

1. Download the project files.
2. Navigate to the project directory in your terminal.
3. Run the following command to install key dependencies:

   ```bash
   npm install
   ```

   This will fetch the necessary Zama FHE libraries along with other project dependencies.

## Build and Run the Project

Once you have everything set up, you can compile, test, and run the project using Hardhat commands:

1. **Compile Contracts**:

   ```bash
   npx hardhat compile
   ```

2. **Run Tests**:

   ```bash
   npx hardhat test
   ```

3. **Deploy Contracts**:

   ```bash
   npx hardhat run scripts/deploy.js
   ```

4. **Run the Application**: 

   Start the application with:

   ```bash
   npm start
   ```

With these commands, you will have your FHE-based Go game up and running, ready for players to engage in thrilling matches filled with strategy and surprise.

## Acknowledgements

**Powered by Zama**: We extend our gratitude to the **Zama team** for their pioneering efforts in developing cutting-edge open-source tools that enable confidential and secure blockchain applications. Their commitment to technology has empowered us to create an innovative approach to a classic game, enhancing the experiences of players everywhere.
