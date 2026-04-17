import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm'

export class AddPublishedVersionToEntities1767100000002 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasColumn('chat_flow', 'publishedVersion'))) {
            await queryRunner.addColumn('chat_flow', new TableColumn({ name: 'publishedVersion', type: 'int', isNullable: true }))
        }
        if (!(await queryRunner.hasColumn('assistant', 'publishedVersion'))) {
            await queryRunner.addColumn('assistant', new TableColumn({ name: 'publishedVersion', type: 'int', isNullable: true }))
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn('chat_flow', 'publishedVersion')
        await queryRunner.dropColumn('assistant', 'publishedVersion')
    }
}
