// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title UserOperation
 * @notice User operation struct for EIP-4337
 */
struct UserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    uint256 callGasLimit;
    uint256 verificationGasLimit;
    uint256 preVerificationGas;
    uint256 maxFeePerGas;
    uint256 maxPriorityFeePerGas;
    bytes paymasterAndData;
    bytes signature;
}

library UserOperationLib {
    /**
     * @notice Get the hash of a user operation
     * @param userOp The user operation
     * @param entryPoint EntryPoint address
     * @param chainId Chain ID
     * @return User operation hash
     */
    function hash(
        UserOperation calldata userOp,
        address entryPoint,
        uint256 chainId
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            userOp.sender,
            userOp.nonce,
            keccak256(userOp.initCode),
            keccak256(userOp.callData),
            userOp.callGasLimit,
            userOp.verificationGasLimit,
            userOp.preVerificationGas,
            userOp.maxFeePerGas,
            userOp.maxPriorityFeePerGas,
            keccak256(userOp.paymasterAndData),
            entryPoint,
            chainId
        ));
    }
}
