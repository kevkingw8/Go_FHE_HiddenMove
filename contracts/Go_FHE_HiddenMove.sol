pragma solidity ^0.8.24;
import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract GoFHEHiddenMoveFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    uint256 public currentBatchId;
    bool public batchOpen;

    struct EncryptedMove {
        euint32 x;
        euint32 y;
        euint32 revealStep;
    }
    mapping(uint256 => EncryptedMove[]) public encryptedMoves; // batchId -> moves

    struct DecryptedMove {
        uint32 x;
        uint32 y;
        uint32 revealStep;
    }
    mapping(uint256 => DecryptedMove[]) public decryptedMoves; // batchId -> moves

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address account);
    event Unpaused(address account);
    event CooldownSecondsSet(uint256 oldCooldown, uint256 newCooldown);
    event BatchOpened(uint256 batchId);
    event BatchClosed(uint256 batchId);
    event HiddenMoveSubmitted(address indexed provider, uint256 batchId, bytes32 xCt, bytes32 yCt, bytes32 revealStepCt);
    event DecryptionRequested(uint256 indexed requestId, uint256 batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 batchId, DecryptedMove[] moves);

    error NotOwner();
    error NotProvider();
    error PausedError();
    error CooldownActive();
    error BatchNotOpen();
    error BatchAlreadyOpen();
    error InvalidBatchId();
    error ReplayDetected();
    error StateMismatch();
    error InvalidProof();
    error NotInitialized();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedError();
        _;
    }

    modifier respectCooldown(address user, mapping(address => uint256) storage lastTime) {
        if (block.timestamp < lastTime[user] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        emit ProviderAdded(owner);
        cooldownSeconds = 10; // Default cooldown
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        if (!paused) revert PausedError(); // Cannot unpause if not paused
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        require(newCooldownSeconds > 0, "Cooldown must be positive");
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsSet(oldCooldown, newCooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (batchOpen) revert BatchAlreadyOpen();
        currentBatchId++;
        batchOpen = true;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batchOpen) revert BatchNotOpen();
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitHiddenMove(euint32 x, euint32 y, euint32 revealStep)
        external
        onlyProvider
        whenNotPaused
        respectCooldown(msg.sender, lastSubmissionTime)
    {
        if (!batchOpen) revert BatchNotOpen();
        _initIfNeeded(x);
        _initIfNeeded(y);
        _initIfNeeded(revealStep);

        encryptedMoves[currentBatchId].push(EncryptedMove(x, y, revealStep));
        lastSubmissionTime[msg.sender] = block.timestamp;

        emit HiddenMoveSubmitted(
            msg.sender,
            currentBatchId,
            FHE.toBytes32(x),
            FHE.toBytes32(y),
            FHE.toBytes32(revealStep)
        );
    }

    function requestBatchDecryption(uint256 batchId)
        external
        onlyProvider
        whenNotPaused
        respectCooldown(msg.sender, lastDecryptionRequestTime)
    {
        if (batchId == 0 || batchId > currentBatchId) revert InvalidBatchId();
        EncryptedMove[] storage moves = encryptedMoves[batchId];
        if (moves.length == 0) revert InvalidBatchId(); // Or custom error "BatchEmpty"

        bytes32[] memory cts = new bytes32[](moves.length * 3); // x, y, revealStep for each move
        for (uint i = 0; i < moves.length; i++) {
            cts[i * 3] = FHE.toBytes32(moves[i].x);
            cts[i * 3 + 1] = FHE.toBytes32(moves[i].y);
            cts[i * 3 + 2] = FHE.toBytes32(moves[i].revealStep);
        }

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: batchId,
            stateHash: stateHash,
            processed: false
        });
        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayDetected();
        // Security: Replay protection ensures this callback is processed only once for a given requestId.

        DecryptionContext memory ctx = decryptionContexts[requestId];
        EncryptedMove[] storage moves = encryptedMoves[ctx.batchId];
        if (moves.length == 0) revert InvalidBatchId(); // Should not happen if requestBatchDecryption was called correctly

        bytes32[] memory currentCts = new bytes32[](moves.length * 3);
        for (uint i = 0; i < moves.length; i++) {
            currentCts[i * 3] = FHE.toBytes32(moves[i].x);
            currentCts[i * 3 + 1] = FHE.toBytes32(moves[i].y);
            currentCts[i * 3 + 2] = FHE.toBytes32(moves[i].revealStep);
        }

        bytes32 currentHash = _hashCiphertexts(currentCts);
        // Security: State hash verification ensures that the ciphertexts used for decryption
        // match the ciphertexts currently stored in the contract for that batch.
        // This prevents scenarios where ciphertexts might have changed after the decryption request.
        if (currentHash != ctx.stateHash) revert StateMismatch();

        FHE.checkSignatures(requestId, cleartexts, proof);
        // Security: Proof verification ensures the cleartexts are authentic and correctly decrypted by the FHE provider.

        uint256 numMoves = cleartexts.length / 12; // 3 uint32s per move
        DecryptedMove[] memory decryptedBatchMoves = new DecryptedMove[](numMoves);
        for (uint i = 0; i < numMoves; i++) {
            uint256 offset = i * 12;
            uint32 x = uint32(uint256(bytes32(cleartexts[offset    .. offset + 4])));
            uint32 y = uint32(uint256(bytes32(cleartexts[offset + 4 .. offset + 8])));
            uint32 revealStep = uint32(uint256(bytes32(cleartexts[offset + 8 .. offset + 12])));
            decryptedBatchMoves[i] = DecryptedMove(x, y, revealStep);
        }

        decryptedMoves[ctx.batchId] = decryptedBatchMoves;
        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, ctx.batchId, decryptedBatchMoves);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 val) internal {
        if (!FHE.isInitialized(val)) revert NotInitialized();
    }

    function _requireInitialized(euint32 val) internal view {
        if (!FHE.isInitialized(val)) revert NotInitialized();
    }
}