import { logger } from '../utils/logger';
import { extractProjectNameFromPath } from '../utils/pathUtils';
import { CdpService, CdpServiceOptions } from './cdpService';
import { ApprovalDetector } from './approvalDetector';
import { ErrorPopupDetector } from './errorPopupDetector';
import { PlanningDetector } from './planningDetector';
import { RunCommandDetector } from './runCommandDetector';
import { UserMessageDetector } from './userMessageDetector';

/**
 * Pool that manages independent CdpService instances per workspace.
 *
 * Each workspace owns its own WebSocket / contexts / pendingCalls, so
 * switching to workspace B while workspace A's ResponseMonitor is polling
 * does not destroy A's WebSocket.
 */
export class CdpConnectionPool {
    private readonly connections = new Map<string, CdpService>();
    private readonly approvalDetectors = new Map<string, ApprovalDetector>();
    private readonly errorPopupDetectors = new Map<string, ErrorPopupDetector>();
    private readonly planningDetectors = new Map<string, PlanningDetector>();
    private readonly runCommandDetectors = new Map<string, RunCommandDetector>();
    private readonly userMessageDetectors = new Map<string, UserMessageDetector>();
    private readonly connectingPromises = new Map<string, Promise<CdpService>>();
    private readonly cdpOptions: CdpServiceOptions;

    constructor(cdpOptions: CdpServiceOptions = {}) {
        this.cdpOptions = cdpOptions;
    }

    /**
     * Get a CdpService for the given workspace path.
     * Creates a new connection and caches it if not already connected.
     * Prevents concurrent connections via Promise locking.
     *
     * @param workspacePath Full path of the workspace
     * @returns Connected CdpService
     */
    async getOrConnect(workspacePath: string): Promise<CdpService> {
        // Return existing connection if available
        const existing = this.connections.get(workspacePath);
        if (existing && existing.isConnected()) {
            // Re-validate that the still-open window is actually bound to this workspace.
            await existing.discoverAndConnectForWorkspace(workspacePath);
            return existing;
        }

        // Wait for the pending connection promise if one exists (prevents concurrent connections)
        const pending = this.connectingPromises.get(workspacePath);
        if (pending) {
            return pending;
        }

        const projectName = this.extractProjectName(workspacePath);

        // Start a new connection
        const connectPromise = this.createAndConnect(workspacePath, projectName);
        this.connectingPromises.set(workspacePath, connectPromise);

        try {
            const cdp = await connectPromise;
            return cdp;
        } finally {
            this.connectingPromises.delete(workspacePath);
        }
    }

    /**
     * Get a connected CdpService (read-only).
     * Returns null if not connected.
     */
    getConnected(workspacePath: string): CdpService | null {
        const cdp = this.connections.get(workspacePath);
        if (cdp && cdp.isConnected()) {
            return cdp;
        }
        return null;
    }

    /**
     * Disconnect the specified workspace.
     */
    disconnectWorkspace(workspacePath: string): void {
        const cdp = this.connections.get(workspacePath);
        if (cdp) {
            cdp.disconnect().catch((err) => {
                logger.error(`[CdpConnectionPool] Error while disconnecting ${workspacePath}:`, err);
            });
            this.connections.delete(workspacePath);
        }

        const detector = this.approvalDetectors.get(workspacePath);
        if (detector) {
            detector.stop();
            this.approvalDetectors.delete(workspacePath);
        }

        const errorPopupDetector = this.errorPopupDetectors.get(workspacePath);
        if (errorPopupDetector) {
            errorPopupDetector.stop();
            this.errorPopupDetectors.delete(workspacePath);
        }

        const planningDetector = this.planningDetectors.get(workspacePath);
        if (planningDetector) {
            planningDetector.stop();
            this.planningDetectors.delete(workspacePath);
        }

        const runCmdDetector = this.runCommandDetectors.get(workspacePath);
        if (runCmdDetector) {
            runCmdDetector.stop();
            this.runCommandDetectors.delete(workspacePath);
        }

        const userMsgDetector = this.userMessageDetectors.get(workspacePath);
        if (userMsgDetector) {
            userMsgDetector.stop();
            this.userMessageDetectors.delete(workspacePath);
        }
    }

    /**
     * Disconnect all workspace connections.
     */
    disconnectAll(): void {
        for (const workspacePath of [...this.connections.keys()]) {
            this.disconnectWorkspace(workspacePath);
        }
    }

    /**
     * Register an approval detector for a workspace.
     */
    registerApprovalDetector(workspacePath: string, detector: ApprovalDetector): void {
        // Stop existing detector
        const existing = this.approvalDetectors.get(workspacePath);
        if (existing && existing.isActive()) {
            existing.stop();
        }
        this.approvalDetectors.set(workspacePath, detector);
    }

    /**
     * Get the approval detector for a workspace.
     */
    getApprovalDetector(workspacePath: string): ApprovalDetector | undefined {
        return this.approvalDetectors.get(workspacePath);
    }

    /**
     * Register an error popup detector for a workspace.
     */
    registerErrorPopupDetector(workspacePath: string, detector: ErrorPopupDetector): void {
        // Stop existing detector
        const existing = this.errorPopupDetectors.get(workspacePath);
        if (existing && existing.isActive()) {
            existing.stop();
        }
        this.errorPopupDetectors.set(workspacePath, detector);
    }

    /**
     * Get the error popup detector for a workspace.
     */
    getErrorPopupDetector(workspacePath: string): ErrorPopupDetector | undefined {
        return this.errorPopupDetectors.get(workspacePath);
    }

    /**
     * Register a planning detector for a workspace.
     */
    registerPlanningDetector(workspacePath: string, detector: PlanningDetector): void {
        // Stop existing detector
        const existing = this.planningDetectors.get(workspacePath);
        if (existing && existing.isActive()) {
            existing.stop();
        }
        this.planningDetectors.set(workspacePath, detector);
    }

    /**
     * Get the planning detector for a workspace.
     */
    getPlanningDetector(workspacePath: string): PlanningDetector | undefined {
        return this.planningDetectors.get(workspacePath);
    }

    /**
     * Register a run command detector for a workspace.
     */
    registerRunCommandDetector(workspacePath: string, detector: RunCommandDetector): void {
        const existing = this.runCommandDetectors.get(workspacePath);
        if (existing && existing.isActive()) {
            existing.stop();
        }
        this.runCommandDetectors.set(workspacePath, detector);
    }

    /**
     * Get the run command detector for a workspace.
     */
    getRunCommandDetector(workspacePath: string): RunCommandDetector | undefined {
        return this.runCommandDetectors.get(workspacePath);
    }

    /**
     * Register a user message detector for a workspace.
     */
    registerUserMessageDetector(workspacePath: string, detector: UserMessageDetector): void {
        const existing = this.userMessageDetectors.get(workspacePath);
        if (existing && existing.isActive()) {
            existing.stop();
        }
        this.userMessageDetectors.set(workspacePath, detector);
    }

    /**
     * Get the user message detector for a workspace.
     */
    getUserMessageDetector(workspacePath: string): UserMessageDetector | undefined {
        return this.userMessageDetectors.get(workspacePath);
    }

    /**
     * Return a list of workspace names with active connections.
     */
    getActiveWorkspacePaths(): string[] {
        const active: string[] = [];
        for (const [path, cdp] of this.connections) {
            if (cdp.isConnected()) {
                active.push(path);
            }
        }
        return active;
    }

    /**
     * Extract the project name from a workspace path.
     */
    extractProjectName(workspacePath: string): string {
        return extractProjectNameFromPath(workspacePath) || workspacePath;
    }

    /**
     * Create a new CdpService and connect to the workspace.
     */
    private async createAndConnect(workspacePath: string, projectName: string): Promise<CdpService> {
        // Disconnect old connection if exists
        const old = this.connections.get(workspacePath);
        if (old) {
            await old.disconnect().catch(() => {});
            this.connections.delete(workspacePath);
        }

        const cdp = new CdpService(this.cdpOptions);

        // Auto-cleanup on disconnect
        cdp.on('disconnected', () => {
            logger.error(`[CdpConnectionPool] Workspace "${projectName}" (${workspacePath}) disconnected`);
            // Only remove from Map when reconnection fails
            // (CdpService attempts reconnection internally, so we don't remove here)
        });

        cdp.on('reconnectFailed', () => {
            logger.error(`[CdpConnectionPool] Reconnection failed for workspace "${projectName}" (${workspacePath}). Removing from pool`);
            this.connections.delete(workspacePath);
            const detector = this.approvalDetectors.get(workspacePath);
            if (detector) {
                detector.stop();
                this.approvalDetectors.delete(workspacePath);
            }
            const errorDetector = this.errorPopupDetectors.get(workspacePath);
            if (errorDetector) {
                errorDetector.stop();
                this.errorPopupDetectors.delete(workspacePath);
            }
            const planDetector = this.planningDetectors.get(workspacePath);
            if (planDetector) {
                planDetector.stop();
                this.planningDetectors.delete(workspacePath);
            }
            const runCmdDetector = this.runCommandDetectors.get(workspacePath);
            if (runCmdDetector) {
                runCmdDetector.stop();
                this.runCommandDetectors.delete(workspacePath);
            }
            const userMsgDetector = this.userMessageDetectors.get(workspacePath);
            if (userMsgDetector) {
                userMsgDetector.stop();
                this.userMessageDetectors.delete(workspacePath);
            }
        });

        // Connect to the workspace
        await cdp.discoverAndConnectForWorkspace(workspacePath);
        this.connections.set(workspacePath, cdp);

        return cdp;
    }
}
