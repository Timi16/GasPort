// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {UserOperation} from "../libraries/UserOperation.sol";

/**
 * @title IPaymaster
 * @notice Interface for EIP-4337 Paymaster
 */
interface IPaymaster {
    enum PostOpMode {
        opSucceeded,
        opReverted,
        postOpReverted
    }

    /**
     * @notice Validate user operation and return validation data
     * @param userOp The user operation
     * @param userOpHash Hash of the user operation
     * @param maxCost Maximum cost of this operation
     * @return context Context to pass to postOp
     * @return validationData Validation result (0 for valid)
     */
    function validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData);

    /**
     * @notice Post-operation handler
     * @param mode Whether the op succeeded or reverted
     * @param context Context from validatePaymasterUserOp
     * @param actualGasCost Actual gas cost
     */
    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost
    ) external;
}
