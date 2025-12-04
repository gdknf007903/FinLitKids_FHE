// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32 } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract FinLitKidsFHE is SepoliaConfig {
    struct EncryptedBehavior {
        uint256 id;
        euint32 encryptedSavings;
        euint32 encryptedSpending;
        euint32 encryptedPreferences;
        uint256 timestamp;
    }

    struct DecryptedBehavior {
        uint256 savings;
        uint256 spending;
        string preferences;
        bool isRevealed;
    }

    uint256 public behaviorCount;
    mapping(uint256 => EncryptedBehavior) public encryptedBehaviors;
    mapping(uint256 => DecryptedBehavior) public decryptedBehaviors;

    mapping(string => euint32) private encryptedLessonCounts;
    string[] private lessonList;

    mapping(uint256 => uint256) private requestToBehaviorId;

    event BehaviorSubmitted(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event BehaviorDecrypted(uint256 indexed id);

    modifier onlyOwner(uint256 behaviorId) {
        _;
    }

    function submitEncryptedBehavior(
        euint32 encryptedSavings,
        euint32 encryptedSpending,
        euint32 encryptedPreferences
    ) public {
        behaviorCount += 1;
        uint256 newId = behaviorCount;

        encryptedBehaviors[newId] = EncryptedBehavior({
            id: newId,
            encryptedSavings: encryptedSavings,
            encryptedSpending: encryptedSpending,
            encryptedPreferences: encryptedPreferences,
            timestamp: block.timestamp
        });

        decryptedBehaviors[newId] = DecryptedBehavior({
            savings: 0,
            spending: 0,
            preferences: "",
            isRevealed: false
        });

        emit BehaviorSubmitted(newId, block.timestamp);
    }

    function requestBehaviorDecryption(uint256 behaviorId) public onlyOwner(behaviorId) {
        EncryptedBehavior storage behavior = encryptedBehaviors[behaviorId];
        require(!decryptedBehaviors[behaviorId].isRevealed, "Already decrypted");

        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(behavior.encryptedSavings);
        ciphertexts[1] = FHE.toBytes32(behavior.encryptedSpending);
        ciphertexts[2] = FHE.toBytes32(behavior.encryptedPreferences);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptBehavior.selector);
        requestToBehaviorId[reqId] = behaviorId;

        emit DecryptionRequested(behaviorId);
    }

    function decryptBehavior(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 behaviorId = requestToBehaviorId[requestId];
        require(behaviorId != 0, "Invalid request");

        EncryptedBehavior storage eBehavior = encryptedBehaviors[behaviorId];
        DecryptedBehavior storage dBehavior = decryptedBehaviors[behaviorId];
        require(!dBehavior.isRevealed, "Already decrypted");

        FHE.checkSignatures(requestId, cleartexts, proof);

        (uint256 savings, uint256 spending, string memory preferences) = abi.decode(cleartexts, (uint256, uint256, string));

        dBehavior.savings = savings;
        dBehavior.spending = spending;
        dBehavior.preferences = preferences;
        dBehavior.isRevealed = true;

        if (!FHE.isInitialized(encryptedLessonCounts[preferences])) {
            encryptedLessonCounts[preferences] = FHE.asEuint32(0);
            lessonList.push(preferences);
        }
        encryptedLessonCounts[preferences] = FHE.add(encryptedLessonCounts[preferences], FHE.asEuint32(1));

        emit BehaviorDecrypted(behaviorId);
    }

    function getDecryptedBehavior(uint256 behaviorId) public view returns (
        uint256 savings,
        uint256 spending,
        string memory preferences,
        bool isRevealed
    ) {
        DecryptedBehavior storage b = decryptedBehaviors[behaviorId];
        return (b.savings, b.spending, b.preferences, b.isRevealed);
    }

    function getEncryptedLessonCount(string memory lesson) public view returns (euint32) {
        return encryptedLessonCounts[lesson];
    }

    function requestLessonCountDecryption(string memory lesson) public {
        euint32 count = encryptedLessonCounts[lesson];
        require(FHE.isInitialized(count), "Lesson not found");

        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(count);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptLessonCount.selector);
        requestToBehaviorId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(lesson)));
    }

    function decryptLessonCount(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 lessonHash = requestToBehaviorId[requestId];
        string memory lesson = getLessonFromHash(lessonHash);

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32 count = abi.decode(cleartexts, (uint32));
    }

    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }

    function getLessonFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < lessonList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(lessonList[i]))) == hash) {
                return lessonList[i];
            }
        }
        revert("Lesson not found");
    }
}